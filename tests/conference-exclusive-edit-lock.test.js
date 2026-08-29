const assert=require('assert');
const fs=require('fs');
const path=require('path');
const vm=require('vm');
const managerSource=fs.readFileSync(path.join(__dirname,'../js/sync/conference-edit-lock-manager.js'),'utf8');
const scriptSource=fs.readFileSync(path.join(__dirname,'../script.js'),'utf8');
const stateSource=fs.readFileSync(path.join(__dirname,'../state.js'),'utf8');
const lockClientSource=fs.readFileSync(path.join(__dirname,'../js/sync/conference-locks.js'),'utf8');
const migrationSource=fs.readFileSync(path.join(__dirname,'../supabase/migrations/20260806_6_0_0_conference_section_locks.sql'),'utf8');

function device(id,server){
  const local='local-a',remote='11111111-1111-4111-8111-111111111111';
  const intervals=[];let current=local,queueWrites=0,mutations=0;
  const sandbox={window:null,Promise,Date,JSON,Object,String,navigator:{onLine:true},
    getCurrentConference:()=>current?{id:current}:null,
    ConferenceLinkStore:{get:()=>({remoteConferenceId:remote,linkStatus:'linked'})},
    ConferenceLocks:{
      acquireLock:(conference,options)=>server.acquire(id,conference,options),
      renewLock:(conference,options)=>server.renew(id,conference,options),
      releaseLock:(conference,options)=>server.release(id,conference,options),
      getLockStatus:(conference,options)=>server.status(id,conference,options),
      getOwnedLock:(conference,section)=>server.owned(id,conference,section)
    },
    setInterval:fn=>{intervals.push(fn);return intervals.length;},clearInterval:()=>{},
    addEventListener:()=>{},renderAccommodation:()=>{},showToast:()=>{}};
  sandbox.window=sandbox;vm.createContext(sandbox);vm.runInContext(managerSource,sandbox);
  return {api:sandbox.ConferenceEditLockManager,intervals,setCurrent:v=>{current=v;},mutate:()=>{if(sandbox.ConferenceEditLockManager.requireAccommodationMutation()){mutations++;queueWrites++;return true;}return false;},counts:()=>({mutations,queueWrites})};
}

function lockServer(){
  let owner=null,token=null,expires=0,clock=Date.now(),acquires=0;
  const data=id=>({section:'accommodation',owned:owner===id&&expires>clock,deviceId:owner,lockToken:owner===id?token:null,expiresAt:new Date(expires).toISOString(),serverNow:new Date(clock).toISOString(),lastRenewedAt:new Date(clock).toISOString(),isExpired:expires<=clock});
  return {
    acquire(id,c,o){acquires++;if(!owner||expires<=clock){owner=id;token=id==='A'?'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa':'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';expires=clock+120000;}return Promise.resolve({ok:true,status:owner===id?'acquired':'locked',data:data(id)});},
    renew(id){if(owner!==id||expires<=clock)return Promise.resolve({ok:true,status:'expired',data:data(id)});expires=clock+120000;return Promise.resolve({ok:true,status:'renewed',data:data(id)});},
    release(id){if(owner!==id)return Promise.resolve({ok:true,status:'not_owner',data:data(id)});owner=null;return Promise.resolve({ok:true,status:'released',data:{section:'accommodation',owned:false}});},
    status(id){return Promise.resolve({ok:true,status:owner&&expires>clock?'locked':'not_found',data:data(id)});},
    owned(id){return owner===id?data(id):null;},advance(ms){clock+=ms;},acquires:()=>acquires
  };
}

(async function(){
  const server=lockServer(),a=device('A',server),b=device('B',server);
  assert.strictEqual(server.acquires(),0,'startup/viewing performs no acquire');
  assert.strictEqual(a.mutate(),false,'viewer mutation is blocked');
  assert.deepStrictEqual(a.counts(),{mutations:0,queueWrites:0},'blocked mutation creates no local mutation or queue');
  await Promise.all([a.api.beginAccommodationEdit(),b.api.beginAccommodationEdit()]);
  assert.strictEqual([a.api.getState().canWrite,b.api.getState().canWrite].filter(Boolean).length,1,'one device wins atomic race');
  assert.strictEqual(a.api.getState().section,'accommodation');
  assert.strictEqual(a.intervals.length,1,'one heartbeat is installed');
  await a.api.beginAccommodationEdit();assert.strictEqual(a.intervals.length,1,'repeated begin creates no duplicate heartbeat');
  assert.strictEqual(a.mutate(),true,'owner can mutate accommodation');
  assert.strictEqual(b.mutate(),false,'read-only device cannot mutate or queue');
  await a.api.endAccommodationEdit();
  assert.strictEqual(a.api.getState().heartbeatTimerCount,0,'end edit stops heartbeat');
  await b.api.beginAccommodationEdit();assert.strictEqual(b.api.getState().canWrite,true,'second device acquires after release');
  server.advance(121000);await b.api.renew();assert.strictEqual(b.api.getState().canWrite,false,'expired lock blocks next write');

  let resolveLate;const lateServer=lockServer();lateServer.acquire=()=>new Promise(r=>{resolveLate=r;});
  const late=device('A',lateServer);const pending=late.api.beginAccommodationEdit();late.setCurrent('local-b');const ending=late.api.endAccommodationEdit();
  resolveLate({ok:true,status:'acquired',data:{owned:true,section:'accommodation',expiresAt:new Date(Date.now()+120000).toISOString()}});
  const lateResult=await pending;await ending;assert.strictEqual(lateResult.status,'stale_ignored','late acquire after conference switch is ignored');

  assert(!/ConferenceEditLockManager\.begin\(currentConference\.id\)/.test(scriptSource),'startup does not acquire a lock');
  assert(!/ConferenceEditLockManager\.begin\(next\.id\)/.test(scriptSource),'conference opening does not acquire a lock');
  assert(!/ConferenceEditLockManager\.guard/.test(stateSource),'save() is not guarded globally');
  assert(/function saveCurrentConferenceSelection\(\)\{[\s\S]*?var persistedData=activation&&typeof activation\.preparePersistedAppData==='function'[\s\S]*?\?activation\.preparePersistedAppData\(appData\):appData;[\s\S]*?window\.StorageRepository\.saveAppSnapshot\(persistedData,\{skipSyncQueue:true\}\)/.test(stateSource),'conference selection persists authorization-safe data without queue');
  assert(/المرحلة: '\+failedStage/.test(scriptSource),'discovered conference failure shows failedStage');
  assert(/p_section:section/.test(lockClientSource),'client sends the lock section to section RPCs');
  assert(/primary key \(conference_id, section\)/i.test(migrationSource),'database lock identity is conference plus section');
  assert(/clock_timestamp\(\)/i.test(migrationSource)&&/'serverNow'/i.test(migrationSource),'diagnostics use server time');
  assert(/release_conference_section_lock/.test(migrationSource),'owner-token section release RPC exists');
  console.log('conference section edit lock tests passed');
})().catch(error=>{console.error(error);process.exit(1);});
