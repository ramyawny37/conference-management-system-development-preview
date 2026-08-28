const assert=require('assert');
const fs=require('fs');
const path=require('path');
const vm=require('vm');
const {webcrypto}=require('crypto');

const root=path.join(__dirname,'..');
const arbitrationSource=fs.readFileSync(path.join(root,
  'js/storage/local-persistence-arbitration.js'),'utf8');
const diagnosticsSource=fs.readFileSync(path.join(root,
  'js/storage/snapshot-payload-diagnostics.js'),'utf8');
const repositorySource=fs.readFileSync(path.join(root,
  'js/storage/storage-repository.js'),'utf8');
const indexedDBSource=fs.readFileSync(path.join(root,
  'js/storage/indexeddb.js'),'utf8');
const stateSource=fs.readFileSync(path.join(root,'state.js'),'utf8');
const directWriterPaths=[
  'js/sync/local-template-copy-cleanup.js',
  'js/sync/partial-template-state-cleanup.js',
  'js/sync/rejected-shared-template-cleanup.js',
  'js/sync/organization-template-sync.js'
];

function clone(value){return value==null?value:JSON.parse(JSON.stringify(value));}
function payload(name,current){return {version:'test',conferences:[{id:name}],currentConferenceId:current||null};}

function arbitrationEnvironment(settings={}){
  const values=new Map();
  if(settings.localPayload!==undefined)values.set('app',settings.localPayload);
  if(settings.localMetadata!==undefined)values.set(
    'development:app:local_persistence_metadata_v1',settings.localMetadata);
  const localStorage={
    getItem(key){if(settings.localReadFailure)throw new Error('LOCAL_READ_FAILED');return values.has(key)?values.get(key):null;},
    setItem(key,value){values.set(key,value);}
  };
  const window={Promise,Object,Array,String,Number,Date,JSON,TextEncoder,
    Uint8Array,crypto:webcrypto,localStorage,SK:'app',
    BrowserStorageNamespace:{environment:'development'},
    AppIndexedDB:{
      getAppSnapshot(){return settings.indexedReadFailure
        ?Promise.reject(new Error('INDEXED_READ_FAILED'))
        :Promise.resolve(clone(settings.indexedRecord||null));},
      validateAppSnapshot(record){return {valid:!!(record&&record.data&&
        Array.isArray(record.data.conferences)&&
        Object.prototype.hasOwnProperty.call(record.data,'currentConferenceId'))};}
    }
  };
  vm.runInNewContext(arbitrationSource,{window,Promise,Object,Array,String,
    Number,Date,JSON,TextEncoder,Uint8Array});
  return {window,values};
}

async function metadata(api,value,generation){
  const result=await api.createMetadata(value,generation);
  result.writeId='test-'+generation;
  result.writtenAt='2026-08-28T00:00:00.000Z';
  return result;
}

async function inspectPair(indexedPayload,indexedGeneration,localPayload,localGeneration){
  const seed=arbitrationEnvironment();
  const api=seed.window.LocalPersistenceArbitration;
  const indexedMetadata=indexedGeneration
    ?await metadata(api,indexedPayload,indexedGeneration):null;
  const localMetadata=localGeneration
    ?await metadata(api,localPayload,localGeneration):null;
  return arbitrationEnvironment({
    indexedRecord:{conferenceId:'**app_snapshot**',data:indexedPayload,
      persistenceMetadata:indexedMetadata},
    localPayload:JSON.stringify(localPayload),
    localMetadata:localMetadata&&JSON.stringify(localMetadata)
  }).window.LocalPersistenceArbitration.inspect();
}

async function testArbitration(){
  const oldValue=payload('old');
  const newValue=payload('new');
  let result=await inspectPair(newValue,2,oldValue,1);
  assert.strictEqual(result.ok,true);
  assert.strictEqual(result.selected.source,'indexeddb');

  result=await inspectPair(oldValue,1,newValue,2);
  assert.strictEqual(result.selected.source,'localStorage');

  result=await inspectPair(newValue,3,newValue,1);
  assert.strictEqual(result.status,'identical');

  result=await inspectPair(oldValue,2,newValue,2);
  assert.strictEqual(result.code,'LOCAL_PERSISTENCE_AMBIGUOUS');

  result=await inspectPair(oldValue,null,newValue,null);
  assert.strictEqual(result.reason,'UNTRUSTED_DIVERGENCE');

  result=await inspectPair(oldValue,null,oldValue,null);
  assert.strictEqual(result.status,'identical');

  const corrupt=arbitrationEnvironment({indexedRecord:{data:{bad:true}},
    localPayload:JSON.stringify(newValue)});
  result=await corrupt.window.LocalPersistenceArbitration.inspect();
  assert.strictEqual(result.ok,true);
  assert.strictEqual(result.status,'degraded');
  assert.strictEqual(result.selected.source,'localStorage');

  const unreadableIndexed=arbitrationEnvironment({indexedReadFailure:true,
    localPayload:JSON.stringify(newValue)});
  result=await unreadableIndexed.window.LocalPersistenceArbitration.inspect();
  assert.strictEqual(result.code,'LOCAL_PERSISTENCE_UNREADABLE');

  const unreadableLocal=arbitrationEnvironment({localReadFailure:true,
    indexedRecord:{data:newValue}});
  result=await unreadableLocal.window.LocalPersistenceArbitration.inspect();
  assert.strictEqual(result.code,'LOCAL_PERSISTENCE_UNREADABLE');

  const badJson=arbitrationEnvironment({localPayload:'{',
    indexedRecord:{data:newValue}});
  result=await badJson.window.LocalPersistenceArbitration.inspect();
  assert.strictEqual(result.status,'degraded');

  const seed=arbitrationEnvironment();
  const goodMetadata=await metadata(seed.window.LocalPersistenceArbitration,newValue,4);
  goodMetadata.fingerprint='0'.repeat(64);
  const mismatch=arbitrationEnvironment({indexedRecord:{data:oldValue},
    localPayload:JSON.stringify(newValue),
    localMetadata:JSON.stringify(goodMetadata)});
  result=await mismatch.window.LocalPersistenceArbitration.inspect();
  assert.strictEqual(result.code,'LOCAL_PERSISTENCE_AMBIGUOUS');
  assert.strictEqual(result.candidates[1].metadataReason,'METADATA_FINGERPRINT_MISMATCH');

  const corruptMetadata=arbitrationEnvironment({indexedRecord:{data:oldValue},
    localPayload:JSON.stringify(newValue),localMetadata:JSON.stringify({
      contractVersion:1,generation:0,fingerprintAlgorithm:'wrong',fingerprint:'x'
    })});
  result=await corruptMetadata.window.LocalPersistenceArbitration.inspect();
  assert.strictEqual(result.code,'LOCAL_PERSISTENCE_AMBIGUOUS');
  assert.strictEqual(result.candidates[1].metadataReason,'METADATA_INVALID');

  const noValid=arbitrationEnvironment({indexedRecord:{data:{bad:true}},
    localPayload:'{'});
  result=await noValid.window.LocalPersistenceArbitration.inspect();
  assert.strictEqual(result.code,'LOCAL_PERSISTENCE_NO_VALID_CANDIDATE');

  result=await arbitrationEnvironment().window.LocalPersistenceArbitration.inspect();
  assert.strictEqual(result.status,'empty');
  result=await arbitrationEnvironment({indexedRecord:{data:newValue}})
    .window.LocalPersistenceArbitration.inspect();
  assert.strictEqual(result.selected.source,'indexeddb');
  result=await arbitrationEnvironment({localPayload:JSON.stringify(newValue)})
    .window.LocalPersistenceArbitration.inspect();
  assert.strictEqual(result.selected.source,'localStorage');

  const trustedMetadata=await metadata(seed.window.LocalPersistenceArbitration,
    oldValue,8);
  const trustedVsUntrusted=arbitrationEnvironment({
    indexedRecord:{data:oldValue,persistenceMetadata:trustedMetadata},
    localPayload:JSON.stringify(newValue)
  });
  result=await trustedVsUntrusted.window.LocalPersistenceArbitration.inspect();
  assert.strictEqual(result.code,'LOCAL_PERSISTENCE_AMBIGUOUS');
  assert.strictEqual(result.candidates[0].state,'VALID_TRUSTED');
  assert.strictEqual(result.candidates[1].state,'VALID_UNTRUSTED');

  const malformedMetadata=arbitrationEnvironment({indexedRecord:{data:newValue},
    localPayload:JSON.stringify(oldValue),localMetadata:'{'});
  result=await malformedMetadata.window.LocalPersistenceArbitration.inspect();
  assert.strictEqual(result.status,'degraded');
  assert.strictEqual(result.candidates[1].state,'CORRUPT');
}

function repositoryEnvironment(settings={}){
  const calls=[];
  const previous={conferenceId:'**app_snapshot**',data:payload('previous'),
    persistenceMetadata:{generation:1}};
  let current=clone(previous);
  const values=new Map();
  const window={Promise,Object,Array,String,Number,Date,JSON,TextEncoder,
    Uint8Array,crypto:webcrypto,SK:'app',BrowserStorageNamespace:{environment:'development'},
    localStorage:{
      getItem(key){return values.has(key)?values.get(key):null;},
      setItem(key,value){calls.push(['localStorage',key]);if(settings.localFailure||
        settings.localFailureAt===calls.filter(call=>call[0]==='localStorage').length){
        throw Object.assign(new Error('QUOTA'),{name:'QuotaExceededError'});
      }values.set(key,value);}
    },
    AppIndexedDB:{stores:{conferences:'conferences'},
      getAppSnapshot(){return Promise.resolve(clone(current));},
      validateAppSnapshot(record){return {valid:!!(record&&record.data)};},
      saveAppSnapshot(value,meta){calls.push(['save','conferences',meta.generation]);if(settings.indexedFailure)return Promise.reject(new Error('INDEXED_WRITE_FAILED'));current={conferenceId:'**app_snapshot**',data:clone(value),persistenceMetadata:clone(meta)};return Promise.resolve(clone(current));},
      putRecord(store,value){calls.push(['rollback',store,clone(value)]);current=clone(value);return Promise.resolve();},
      deleteAppSnapshot(){calls.push(['deleteSnapshot']);current=null;return Promise.resolve();}
    },
    OfflineFirstIntegration:{handleLocalSave(){return Promise.resolve(settings.queueFailure
      ?{ok:false,error:{code:'SYNC_QUEUE_ENQUEUE_FAILED'}}
      :{ok:true,status:'queued',data:{queueStatus:'enqueued'}});}}
  };
  if(settings.sanitize){
    window.ConferenceActivationAuthorization={preparePersistedAppData(value){
      const sanitized=clone(value);sanitized.currentConferenceId=null;return sanitized;
    }};
  }
  vm.runInNewContext(diagnosticsSource,{window,Promise,Object,Array,String,
    Number,Date,JSON,TextEncoder,Uint8Array,unescape,encodeURIComponent});
  vm.runInNewContext(arbitrationSource,{window,Promise,Object,Array,String,
    Number,Date,JSON,TextEncoder,Uint8Array});
  vm.runInNewContext(repositorySource,{window,Promise,Object,Array,String,
    Number,Date,JSON});
  return {window,calls,values,previous};
}

async function testWrites(){
  let env=repositoryEnvironment({indexedFailure:true});
  await assert.rejects(env.window.StorageRepository.saveAppSnapshot(payload('new')),
    /INDEXED_WRITE_FAILED/);
  assert.strictEqual(env.calls.some(call=>call[0]==='localStorage'),false);

  env=repositoryEnvironment({queueFailure:true});
  await assert.rejects(env.window.StorageRepository.saveAppSnapshot(payload('new')),
    error=>error.code==='SYNC_QUEUE_ENQUEUE_FAILED');
  const rollback=env.calls.find(call=>call[0]==='rollback');
  assert.deepStrictEqual(rollback[2],env.previous);
  assert.strictEqual(env.calls.some(call=>call[0]==='localStorage'),false);

  env=repositoryEnvironment({localFailure:true});
  const degraded=await env.window.StorageRepository.saveAppSnapshot(payload('new'),{skipSyncQueue:true});
  assert.strictEqual(degraded.status,'persisted_mirror_degraded');
  assert.strictEqual(degraded.mirror.code,'LOCAL_STORAGE_QUOTA_EXCEEDED');
  assert.deepStrictEqual([...new Set(env.calls.filter(call=>call[0]==='save'||call[0]==='rollback').map(call=>call[1]))],['conferences']);

  env=repositoryEnvironment({localFailureAt:2});
  const partialMirror=await env.window.StorageRepository.saveAppSnapshot(
    payload('partial'),{skipSyncQueue:true});
  assert.strictEqual(partialMirror.status,'persisted_mirror_degraded');
  assert.strictEqual(JSON.parse(env.values.get('app')).conferences[0].id,'partial');
  assert.strictEqual(env.values.has(
    'development:app:local_persistence_metadata_v1'),false);
  assert.strictEqual(env.calls.filter(call=>call[0]==='save').length,1);

  env=repositoryEnvironment({sanitize:true});
  const saved=await env.window.StorageRepository.saveAppSnapshot(
    payload('sanitized','candidate'),{skipSyncQueue:true});
  const storedPayload=JSON.parse(env.values.get('app'));
  const storedMetadata=JSON.parse(env.values.get('development:app:local_persistence_metadata_v1'));
  assert.strictEqual(storedPayload.currentConferenceId,null);
  const verified=await env.window.LocalPersistenceArbitration.verifyMetadata(storedPayload,storedMetadata);
  assert.strictEqual(verified.trusted,true);

  const cyclic=payload('cyclic');cyclic.self=cyclic;
  const cyclicEnv=repositoryEnvironment();
  await assert.rejects(cyclicEnv.window.StorageRepository.saveAppSnapshot(cyclic),
    error=>error.code==='SNAPSHOT_SERIALIZATION_FAILED');

  const concurrent=repositoryEnvironment();
  await Promise.all([
    concurrent.window.StorageRepository.saveAppSnapshot(payload('tab-a'),
      {skipSyncQueue:true}),
    concurrent.window.StorageRepository.saveAppSnapshot(payload('tab-b'),
      {skipSyncQueue:true})
  ]);
  assert.deepStrictEqual(concurrent.calls.filter(call=>call[0]==='save')
    .map(call=>call[2]),[1,2]);
}

async function testIndexedDBBoundary(){
  const writes=[];
  const database={
    objectStoreNames:{contains(){return true;}},
    transaction(name){
      const transaction={error:null,objectStore(storeName){return {
        put(record){writes.push({storeName,record:clone(record)});const request={};
          setImmediate(()=>{if(request.onsuccess)request.onsuccess();
            setImmediate(()=>transaction.oncomplete&&transaction.oncomplete());});
          return request;}
      }} };
      writes.push({transaction:name});
      return transaction;
    },close(){}
  };
  const indexedDB={open(){const request={result:database};
    setImmediate(()=>request.onsuccess&&request.onsuccess());return request;}};
  const window={Promise,Object,Array,String,Number,Date,JSON,TextEncoder,
    Uint8Array,crypto:webcrypto,indexedDB,
    BrowserStorageNamespace:{databaseName:value=>value},
    SnapshotPayloadDiagnostics:{inspect(value){return {ok:true,
      snapshot:clone(value),sizeBytes:17};},isQuotaExceededError(){return false;}}
  };
  vm.runInNewContext(indexedDBSource,{window,Promise,Object,Array,String,
    Number,Date,JSON,TextEncoder,Uint8Array,unescape,encodeURIComponent});
  const meta={contractVersion:1,generation:7,fingerprint:'a'.repeat(64)};
  await window.AppIndexedDB.saveAppSnapshot(payload('boundary'),meta);
  assert.strictEqual(JSON.stringify(writes.filter(row=>row.transaction)
    .map(row=>row.transaction)),JSON.stringify([['conferences']]));
  const put=writes.find(row=>row.storeName);
  assert.strictEqual(put.storeName,'conferences');
  assert.strictEqual(put.record.conferenceId,'**app_snapshot**');
  assert.deepStrictEqual(put.record.persistenceMetadata,meta);
}

function testDirectWriterContract(){
  directWriterPaths.forEach(relative=>{
    const source=fs.readFileSync(path.join(root,relative),'utf8');
    assert.doesNotMatch(source,/\.setItem\s*\(\s*global\.SK/,
      relative+' must leave the application snapshot mirror to StorageRepository');
    assert.match(source,/saveAppSnapshot\s*\(/,
      relative+' must retain repository persistence');
  });
}

async function testStartupComposition(){
  const body=stateSource.slice(stateSource.indexOf(
    'function initializeApplicationStorage()'),stateSource.indexOf('\nfunction save(options)'));
  const events=[];
  const selected=payload('startup','candidate');
  const window={Promise,structuredClone:clone,localStorage:{},
    DeviceReauthorizationFlow:{waitUntilApproved(){events.push('device');return Promise.resolve();}},
    LocalPersistenceArbitration:{inspect(){events.push('arbitrate');return Promise.resolve({ok:true,status:'selected',selected:{source:'localStorage',payload:selected}});}},
    AppIndexedDB:{},ConferenceActivationAuthorization:{
      capturePersistedCandidate(id,source){events.push('capture:'+id+':'+source);},
      preparePersistedAppData(value){return clone(value);}
    }
  };
  const sandbox={window,Promise,JSON,console,SK:'app',appData:payload('default'),
    storageInitializationPromise:null,applicationStorageState:{},
    applicationSelectionRestored:false,
    cloneApplicationStorageData:clone,normalizeAppData(){events.push('normalize');},
    restoreSafeSingleCurrentConferenceSelection(){return false;},
    updateLogoText(){},getCurrentConference(){return null;},setCurrentConference(){}};
  vm.runInNewContext(body,sandbox);
  await sandbox.initializeApplicationStorage();
  assert.deepStrictEqual(events.slice(0,4),[
    'device','arbitrate','capture:candidate:localStorage','normalize']);
  assert.strictEqual(sandbox.appData.currentConferenceId,null);
}

async function testStateSaveFailClosed(){
  const body=stateSource.slice(stateSource.indexOf('function save(options)'),
    stateSource.indexOf('\nfunction getStorageUsageReport'));
  function environment(withRepository){
    const writes=[];const notifications=[];const saves=[];
    const window={Promise,ConferenceActivationAuthorization:{
      preparePersistedAppData(value){const next=clone(value);
        next.currentConferenceId='sanitized-candidate';return next;}
    }};
    if(withRepository){window.StorageRepository={saveAppSnapshot(value,options){
      saves.push({value:clone(value),options});return Promise.resolve({
        mirror:{ok:true}});
    }};}
    const sandbox={window,Promise,JSON,Date,Error,console,appData:payload('state'),
      SK:'app',applicationStorageState:{},localStorage:{setItem(key,value){
        writes.push({key,value});}},reconcileAccommodationRoomKeyHolders:null,
      updateCurrentConferenceData(){},getCurrentConference(){return null;},
      notifyPersistenceFailure(message){notifications.push(message);}};
    vm.runInNewContext(body,sandbox);
    return {sandbox,writes,notifications,saves};
  }

  let env=environment(false);
  assert.strictEqual(env.sandbox.save(),false);
  assert.strictEqual(env.writes.length,0);
  assert.strictEqual(env.notifications.length,1);
  assert.strictEqual(env.sandbox.applicationStorageState.lastStorageError.code,
    'LOCAL_PERSISTENCE_REPOSITORY_UNAVAILABLE');
  assert.strictEqual(env.sandbox.saveCurrentConferenceSelection(),false);
  assert.strictEqual(env.writes.length,0);
  assert.strictEqual(env.sandbox.applicationStorageState.lastStorageError.code,
    'LOCAL_PERSISTENCE_REPOSITORY_UNAVAILABLE');

  env=environment(true);
  assert.strictEqual(env.sandbox.save(),true);
  assert.strictEqual(env.sandbox.saveCurrentConferenceSelection(),true);
  await Promise.resolve();await Promise.resolve();
  assert.strictEqual(env.saves.length,2);
  assert.strictEqual(env.saves[0].value.currentConferenceId,
    'sanitized-candidate');
  assert.strictEqual(env.writes.length,0);
}

function testAuthorizationComposition(){
  assert.match(stateSource,/DeviceReauthorizationFlow\.waitUntilApproved\(\)[\s\S]*arbitration\.inspect/);
  assert.match(stateSource,/capturePersistedCandidate\(persistedCandidate,selection\.source\)[\s\S]*appData\.currentConferenceId=null/);
  assert.match(stateSource,/preparePersistedAppData\(appData\)[\s\S]*StorageRepository\.saveAppSnapshot/);
  assert.doesNotMatch(stateSource,/arbitration\.inspect[\s\S]{0,1200}localStorage\.setItem/);
}

(async function(){
  await testArbitration();
  await testWrites();
  await testIndexedDBBoundary();
  testDirectWriterContract();
  await testStartupComposition();
  await testStateSaveFailClosed();
  testAuthorizationComposition();
  console.log('local persistence arbitration tests passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
