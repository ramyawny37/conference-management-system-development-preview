const assert=require('assert');
const fs=require('fs');
const path=require('path');
const vm=require('vm');

const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const namespaceSource=read('js/storage/environment-namespace.js');

function namespaceFor(pathname){
  const sandbox={location:{pathname}};
  sandbox.window=sandbox;
  vm.runInNewContext(namespaceSource,sandbox);
  return sandbox.BrowserStorageNamespace;
}

function memoryStorage(initial){
  const values=Object.assign({},initial);
  return {
    values,
    getItem:key=>Object.prototype.hasOwnProperty.call(values,key)
      ?values[key]:null,
    setItem:(key,value)=>{values[key]=String(value);},
    removeItem:key=>{delete values[key];}
  };
}

const production=namespaceFor('/conference-management-system-v1/');
assert.strictEqual(production.environment,'production');
assert.strictEqual(production.key('conf_v5'),'conf_v5');
assert.strictEqual(production.databaseName('conference_manager_v3'),
  'conference_manager_v3');

const development=namespaceFor(
  '/conference-management-system-development-preview/'
);
const prefix='cms:development:gppwltrifgfxrkzvvxoe:';
assert.strictEqual(development.environment,'development');
assert.strictEqual(development.projectRef,'gppwltrifgfxrkzvvxoe');
assert.strictEqual(development.key('conf_v5'),prefix+'conf_v5');
assert.strictEqual(development.databaseName('conference_manager_v3'),
  prefix+'conference_manager_v3');

const staleLink={
  localConferenceId:'e711a3ba-fea3-416a-ba1d-7caf4c3e931e',
  remoteConferenceId:'78b1b30a-6ef9-4f8c-89e7-fb71d4b6b9aa',
  knownRevision:47,
  linkStatus:'linked'
};
const legacyRaw=JSON.stringify({[staleLink.localConferenceId]:staleLink});
const storage=memoryStorage({conference_manager_sync_links:legacyRaw});
const linkSandbox={
  BrowserStorageNamespace:development,
  localStorage:storage,
  structuredClone:global.structuredClone,
  JSON,Date,Object,Array,String,Number,Error
};
linkSandbox.window=linkSandbox;
vm.runInNewContext(read('js/sync/conference-link-store.js'),linkSandbox);
assert.deepStrictEqual(
  JSON.parse(JSON.stringify(linkSandbox.ConferenceLinkStore.list())),[]
);
const newLink={
  localConferenceId:'11111111-1111-4111-8111-111111111111',
  remoteConferenceId:'22222222-2222-4222-8222-222222222222',
  knownRevision:0,
  linkStatus:'linked'
};
assert.strictEqual(linkSandbox.ConferenceLinkStore.save(newLink).ok,true);
assert.strictEqual(storage.values.conference_manager_sync_links,legacyRaw,
  'Development writes must not alter the Production legacy link key');
assert.ok(storage.values[prefix+'conference_manager_sync_links']);

const idStorage=memoryStorage({
  conference_manager_device_identity:JSON.stringify({
    id:'33333333-3333-4333-8333-333333333333',
    deviceName:'Production device',platform:'test',createdAt:'old'
  })
});
const idSandbox={
  BrowserStorageNamespace:development,
  localStorage:idStorage,
  SupabaseAuth:{getSession:()=>({user:{id:'55555555-5555-4555-8555-555555555555'}})},
  crypto:{randomUUID:()=> '44444444-4444-4444-8444-444444444444'},
  navigator:{platform:'test'},JSON,Object,String,Date,Uint8Array,Array
};
idSandbox.window=idSandbox;
vm.runInNewContext(read('js/supabase/device-identity.js'),idSandbox);
assert.strictEqual(idSandbox.SupabaseDeviceIdentity.getOrCreate().id,
  '44444444-4444-4444-8444-444444444444');
assert.ok(idStorage.values[prefix+'device-identity:55555555-5555-4555-8555-555555555555']);
assert.ok(idStorage.values.conference_manager_device_identity.includes(
  '33333333-3333-4333-8333-333333333333'
));

function exportedDatabaseName(file,exportName){
  const sandbox={BrowserStorageNamespace:development,Promise,Error,Object,
    Array,String,Number,JSON,Date,Uint8Array,Blob:function(){}};
  sandbox.window=sandbox;
  vm.runInNewContext(read(file),sandbox);
  return sandbox[exportName].databaseName;
}
assert.strictEqual(exportedDatabaseName(
  'js/storage/indexeddb.js','AppIndexedDB'
),prefix+'conference_manager_v3');
assert.strictEqual(exportedDatabaseName(
  'js/sync/conference-membership-attempt-store.js',
  'ConferenceMembershipAttemptStore'
),prefix+'conference_manager_membership_attempts');

const index=read('index.html');
assert.ok(index.indexOf('js/storage/environment-namespace.js')<
  index.indexOf('js/storage/indexeddb.js'));
const worker=read('service-worker.js');
assert.ok(worker.includes("'cms:development:' + DEVELOPMENT_PROJECT_REF + ':'"));
assert.ok(worker.includes('const CACHE_PREFIX = CACHE_NAMESPACE +'));
assert.ok(!worker.includes('localStorage.clear'));
assert.ok(!worker.includes('indexedDB.deleteDatabase'));

function workerCacheName(pathname){
  const sandbox={
    self:{
      location:{pathname,origin:'https://ramyawny37.github.io'},
      addEventListener:()=>{}
    },
    URL,Promise,console
  };
  vm.runInNewContext(
    worker+'\n;globalThis.__cacheName=CACHE_NAME;',sandbox
  );
  return sandbox.__cacheName;
}
const productionCache=workerCacheName('/conference-management-system-v1/service-worker.js');
const developmentCache=workerCacheName(
  '/conference-management-system-development-preview/service-worker.js'
);
assert.ok(productionCache.startsWith('conference-manager-core-'));
assert.ok(developmentCache.startsWith(
  prefix+'conference-manager-core-'
));
assert.notStrictEqual(developmentCache,productionCache);

const activeSources=[
  'state.js',
  'js/storage/full-backup.js',
  'js/supabase/device-identity.js',
  'js/supabase/runtime-config.js',
  'js/supabase/system-access-service.js',
  'js/sync/automatic-sync-preferences.js',
  'js/sync/conference-link-store.js',
  'js/sync/conference-linking-attempt-store.js',
  'js/sync/device-authorization-operation-repository.js',
  'js/sync/link-status-diagnostic-store.js',
  'js/sync/legacy-conference-organization-assignment-attempt-store.js',
  'js/sync/remote-update-store.js',
  'js/sync/wrong-remote-binding-repair-service.js',
  'js/sync/wrong-remote-binding-repair-store.js'
];
activeSources.forEach(file=>{
  const source=read(file);
  assert.ok(/namespace\.key|storageKey\(|browserStorageNamespace\.key/.test(source),
    file+' must route persistent keys through the environment namespace');
});

console.log('browser storage isolation tests passed');
