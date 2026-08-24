const assert=require('assert');
const fs=require('fs');
const path=require('path');
const vm=require('vm');

const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'js/storage/storage-repository.js'),'utf8');

function clone(value){return JSON.parse(JSON.stringify(value));}
function app(name){return {version:'2.0.0',currentConferenceId:null,
  conferences:[{id:name,name:name}],templates:[],archives:[],backups:[],
  houseTemplates:[]};}
function load(settings){
  settings=settings||{};
  const values=Object.assign({},settings.localValues||{});
  const localStorage={
    getItem:key=>Object.prototype.hasOwnProperty.call(values,key)?values[key]:null,
    setItem:(key,value)=>{values[key]=String(value);}
  };
  const indexed={snapshot:settings.indexedSnapshot||null,
    saveCalls:[],otherStoreCalls:0,
    getAppSnapshot(){return Promise.resolve(this.snapshot);},
    getAllRecords(){this.otherStoreCalls++;return Promise.resolve([]);},
    deleteRecord(){this.otherStoreCalls++;return Promise.resolve();},
    saveAppSnapshot(data,options){this.saveCalls.push({data:clone(data),options:clone(options)});
      if(settings.failIndexedWrite)return Promise.reject(new Error('INDEXEDDB_WRITE_FAILED'));
      this.snapshot=Object.assign({data:clone(data)},options);return Promise.resolve(true);}};
  const sandbox={window:null,structuredClone:clone,JSON,Promise,Number,Object,Array,
    Math,String,Error,localStorage,AppIndexedDB:indexed};
  sandbox.window=sandbox;
  vm.runInNewContext(source,sandbox,{filename:'storage-repository.js'});
  return {api:sandbox.StorageRepository,indexed,values};
}
function meta(api,generation,data){const json=JSON.stringify(data);return {
  version:1,generation,fingerprint:api.fingerprintJson(json)};}
function indexed(api,generation,data){const value=meta(api,generation,data);return {
  data:clone(data),persistenceVersion:value.version,
  persistenceGeneration:value.generation,persistenceFingerprint:value.fingerprint};}
function localValues(api,generation,data){return {
  conf_v5:JSON.stringify(data),conference_manager_local_persistence_v1:
    JSON.stringify(meta(api,generation,data))};}

(async function(){
  let env=load();
  let older=app('older'),newer=app('newer');

  env=load();
  env.indexed.snapshot=indexed(env.api,2,newer);
  Object.assign(env.values,localValues(env.api,1,older));
  let chosen=await env.api.resolveAppSnapshot({defaults:app('default')});
  assert.strictEqual(chosen.source,'indexeddb');
  assert.strictEqual(chosen.data.conferences[0].name,'newer');
  assert.strictEqual(env.indexed.saveCalls.length,0);
  assert.strictEqual(env.values.conf_v5,JSON.stringify(older));

  env=load();
  env.indexed.snapshot=indexed(env.api,1,older);
  Object.assign(env.values,localValues(env.api,2,newer));
  chosen=await env.api.resolveAppSnapshot({defaults:app('default')});
  assert.strictEqual(chosen.source,'localStorage');
  assert.strictEqual(chosen.data.conferences[0].name,'newer');
  assert.strictEqual(env.indexed.saveCalls.length,0);
  assert.deepStrictEqual(env.indexed.snapshot.data,older);

  env=load();
  env.indexed.snapshot=indexed(env.api,3,newer);
  Object.assign(env.values,localValues(env.api,3,newer));
  chosen=await env.api.resolveAppSnapshot({defaults:app('default')});
  assert.strictEqual(chosen.status,'equal');
  assert.strictEqual(env.indexed.saveCalls.length,0);

  env=load({localValues:{conf_v5:'{broken'}});
  env.indexed.snapshot=indexed(env.api,1,newer);
  chosen=await env.api.resolveAppSnapshot({defaults:app('default')});
  assert.strictEqual(chosen.source,'indexeddb');

  env=load({localValues:{conf_v5:JSON.stringify(older)},
    indexedSnapshot:{data:clone(newer)}});
  await assert.rejects(env.api.resolveAppSnapshot({defaults:app('default')}),
    error=>error&&error.code==='LOCAL_PERSISTENCE_AMBIGUOUS');
  assert.strictEqual(env.values.conf_v5,JSON.stringify(older));
  assert.deepStrictEqual(env.indexed.snapshot.data,newer);

  env=load({failIndexedWrite:true});
  env.indexed.snapshot=indexed(env.api,1,older);
  await env.api.resolveAppSnapshot({defaults:app('default')});
  await assert.rejects(env.api.saveAppSnapshot(newer),/INDEXEDDB_WRITE_FAILED/);
  const pendingLocal=env.api.inspectLocalStorage();
  assert.strictEqual(pendingLocal.trusted,true);
  assert.strictEqual(pendingLocal.generation,2);
  chosen=await env.api.resolveAppSnapshot({defaults:app('default')});
  assert.strictEqual(chosen.source,'localStorage');

  env=load({localValues:{conf_v5:JSON.stringify(newer)},
    indexedSnapshot:{data:clone(newer)}});
  chosen=await env.api.resolveAppSnapshot({defaults:app('default')});
  assert.strictEqual(chosen.status,'equal');
  assert.strictEqual(chosen.data.conferences[0].name,'newer');

  const queue=[{operationId:'pending'}],conflicts=[{conflictId:'conflict'}];
  env=load();
  env.indexed.snapshot=indexed(env.api,1,newer);
  Object.assign(env.values,localValues(env.api,1,newer));
  await env.api.resolveAppSnapshot({defaults:app('default')});
  assert.strictEqual(env.indexed.otherStoreCalls,0);
  assert.deepStrictEqual(queue,[{operationId:'pending'}]);
  assert.deepStrictEqual(conflicts,[{conflictId:'conflict'}]);

  console.log('local persistence arbitration regression tests: PASS');
})().catch(error=>{console.error(error);process.exitCode=1;});
