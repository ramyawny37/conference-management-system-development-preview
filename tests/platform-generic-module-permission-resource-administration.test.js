'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {spawnSync}=require('node:child_process');
const test=require('node:test');
const vm=require('node:vm');
const {JSDOM}=require('jsdom');

const serviceSource=fs.readFileSync('js/sync/module-permission-administration-service.js','utf8');
const uiSource=fs.readFileSync('js/sync/module-permission-administration-ui.js','utf8');
const migration=fs.readFileSync('supabase/migrations/20260916120000_generic_module_permission_resource_administration.sql','utf8');
const canonicalGrantMigration=fs.readFileSync('supabase/migrations/20260829130000_module_permission_catalog_and_grant_adapter.sql','utf8');
const edge=fs.readFileSync('supabase/functions/platform-device-operation/index.ts','utf8');

test('Platform dispatcher session SELECT parses in PostgreSQL',()=>{
  const select=migration.match(/select item\.\* into session[\s\S]*?profile\.account_status='approved';/)[0]
    .replace(' into session','')
    .replace(/p_session_id/g,"'00000000-0000-0000-0000-000000000001'::uuid")
    .replace(/p_user_id/g,"'00000000-0000-0000-0000-000000000002'::uuid")
    .replace(/p_token_hash/g,"'\\\\x00'::bytea");
  const setup=`begin;
create schema platform;
create schema platform_private;
create table platform_private.device_sessions(id uuid,user_id uuid,token_hash bytea,binding_id uuid,device_authorization_id uuid,device_id uuid,purpose text,revoked_at timestamptz,expires_at timestamptz,public_key_thumbprint text);
create table platform.device_key_bindings(id uuid,user_id uuid,device_id uuid,device_authorization_id uuid,public_key_thumbprint text,algorithm text,lifecycle_status text,revoked_at timestamptz,retired_at timestamptz);
create table platform.user_device_authorizations(id uuid,user_id uuid,device_id uuid,status text,revoked_at timestamptz);
create table platform.devices(id uuid,lifecycle_status text,retired_at timestamptz,compromised_at timestamptz);
create table platform.profiles(user_id uuid,account_status text);
${select}
rollback;`;
  const parsed=spawnSync('psql',['-X','-v','ON_ERROR_STOP=1','-d','postgres','-f','-'],{input:setup,encoding:'utf8'});
  assert.equal(parsed.status,0,parsed.stderr);
});

function uiRuntime(scopeMode,grant){
  const dom=new JSDOM('<div id="module_permission_administration_screen"></div>');
  const calls=[];
  const target='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const event='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  const api={
    isSupportedModule:(key)=>['warehouse','reservations'].includes(key),
    probeAvailability:(moduleKey)=>Promise.resolve({ok:true,data:{ownerConfirmed:true,catalog:[{permissionKey:moduleKey+'.booking.view',displayName:'View',description:'',allowedScopeMode:scopeMode,allowedResourceType:moduleKey==='warehouse'?'store':'event',sensitiveMutation:false}]}}),
    listResources:(moduleKey,type)=>Promise.resolve({ok:true,data:{resources:[{resourceId:event,resourceType:type,code:type==='store'?'S1':null,name:type==='store'?'المخزن الرئيسي':'فعالية سبتمبر',displayName:type==='store'?'المخزن الرئيسي':'فعالية سبتمبر'}]}}),
    searchCandidates:()=>Promise.resolve({ok:true,data:{candidates:[{userId:target,displayName:'User',email:'user@example.invalid',accountStatus:'approved'}]}}),
    listGrants:()=>Promise.resolve({ok:true,data:{grants:grant?[grant]:[]}}),
    foundationMutation:()=>Promise.resolve({ok:false}),
    catalogMutation:(moduleKey,input)=>{calls.push({moduleKey,input});return Promise.resolve({ok:true});}
  };
  dom.window.ModulePermissionAdministrationService=api;
  dom.window.confirm=()=>true;
  vm.runInContext(uiSource,vm.createContext(dom.window));
  return {ui:dom.window.ModulePermissionAdministrationUI,document:dom.window.document,calls,target,event};
}

async function openReservations(runtime){
  await runtime.ui.initialize();
  await runtime.ui.selectModule('reservations');
  await runtime.ui.search('User');
  await runtime.ui.select(runtime.target);
}

test('backend discovery is protected, catalog-authorized, normalized, and supports store plus event',()=>{
  assert.match(migration,/require_current_approved_device\(p_actor_device_id\)/);
  assert.match(migration,/require_module_permission[\s\S]*'module\.manage'/);
  assert.match(migration,/allowed_resource_type=p_resource_type[\s\S]*allowed_scope_mode in\('resource','both'\)/);
  assert.match(migration,/p_module_key='warehouse' and p_resource_type='store'/);
  assert.match(migration,/p_module_key='reservations' and p_resource_type='event'/);
  assert.match(migration,/'resourceId'[\s\S]*'resourceType'[\s\S]*'displayName'/);
  assert.doesNotMatch(migration,/booking_creation_context/);
  assert.match(edge,/list_module_permission_resources_for_administration/);
});

test('Warehouse store discovery retains active-store semantics and no Reservations predicates',()=>{
  const storeBranch=migration.match(/if p_module_key='warehouse'[\s\S]*?elsif p_module_key='reservations'/)[0];
  assert.match(storeBranch,/from warehouse\.stores stores[\s\S]*stores\.status='active'/);
  assert.doesNotMatch(storeBranch,/organization_members|conference_id|has_event_permission/);
});

function canonicalCatalogGrantBody(){
  return canonicalGrantMigration.match(/create function public\.manage_catalog_module_grant\([\s\S]*?\nend;\n\$\$;/)[0];
}

test('event grant uses canonical delegation authority without an invented event-manage precondition',()=>{
  const body=canonicalCatalogGrantBody();
  assert.match(body,/if public\.is_system_owner\(actor_id\)[\s\S]*require_module_permission\(\s*p_actor_device_id, p_module_key, 'module\.manage', null, null/);
  assert.match(body,/validate_module_permission_catalog\(\s*p_module_key, p_permission_key, p_resource_type, p_resource_id/);
  assert.doesNotMatch(body,/reservations\.event\.manage|resolve_event_scope|organization_members|conference_members/);
});

test('event grant outside canonical delegation authority is rejected',()=>{
  const body=canonicalCatalogGrantBody();
  assert.match(body,/require_module_permission\([\s\S]*'module\.manage'/);
  assert.match(body,/authority_grant_id[\s\S]*permission_key = 'module\.manage'[\s\S]*resource_type is null[\s\S]*resource_id is null[\s\S]*revoked_at is null/);
});

test('revoke is grantId-led, exact-resource, and independent of current Event authority',()=>{
  const body=canonicalCatalogGrantBody();
  assert.match(body,/select \* into target_grant[\s\S]*where grants\.grant_id = p_grant_id[\s\S]*for update/);
  assert.match(body,/target_grant\.resource_type is distinct from p_resource_type[\s\S]*target_grant\.resource_id is distinct from p_resource_id[\s\S]*MODULE_GRANT_NOT_FOUND_OR_STALE/);
  assert.doesNotMatch(body,/resolve_event_scope|has_event_permission|organization_members|conference_members/);
});

test('System Owner revoke and recovery policies remain canonical',()=>{
  const body=canonicalCatalogGrantBody();
  const recovery=canonicalGrantMigration.match(/create function public\.recover_revoke_final_module_manager\([\s\S]*?\nend;\n\$\$;/)[0];
  assert.match(body,/authority_source := 'system_owner'/);
  assert.match(body,/if authority_source = 'system_owner'[\s\S]*public\.is_system_owner\(actor_id\)/);
  assert.match(recovery,/if not public\.is_system_owner\(actor_id\)[\s\S]*SYSTEM_OWNER_REQUIRED/);
});

test('module-wide Reservations and Warehouse grant/revoke remain generic and unaffected',()=>{
  const body=canonicalCatalogGrantBody();
  assert.match(body,/p_module_key, p_permission_key, p_resource_type, p_resource_id/);
  assert.match(body,/p_resource_type is null[\s\S]*p_resource_id is null|coalesce\(p_resource_type, '<module>'\)/);
  assert.doesNotMatch(body,/p_module_key\s*=\s*'reservations'|p_module_key\s*=\s*'warehouse'/);
  assert.doesNotMatch(migration,/manage_catalog_module_grant_pre_generic/);
});

test('service discovers normalized generic resources through protected session only',async()=>{
  const calls=[];
  const sandbox={window:{PlatformDeviceSession:{invokeModuleProtected:(module,operation,args)=>{calls.push({module,operation,args});return Promise.resolve([{resourceId:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',resourceType:'store',code:'S1',name:'Store'}]);}}}};
  vm.runInNewContext(serviceSource,sandbox);
  const response=await sandbox.window.ModulePermissionAdministrationService.listResources('warehouse','store');
  assert.equal(response.ok,true);
  assert.equal(response.data.resources[0].resourceId,'dddddddd-dddd-4ddd-8ddd-dddddddddddd');
  assert.equal(calls[0].operation,'list_module_permission_resources_for_administration');
  assert.equal(calls[0].module,'platform');
  assert.equal(calls[0].args.p_module_key,'warehouse');
  assert.equal(calls[0].args.p_resource_type,'store');
  assert.doesNotMatch(serviceSource,/WarehouseTransport|listStores|listEvents/);
});

test('both scope renders module and event grants, sends exact event scope, and resolves history name',async()=>{
  const grant={grantId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',permissionKey:'reservations.booking.view',resourceType:'event',resourceId:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',revokedAt:null,active:true};
  const runtime=uiRuntime('both',grant);
  await openReservations(runtime);
  const html=runtime.ui.renderSection();
  assert.match(html,/data-business-grant/);
  assert.match(html,/فعالية حجز محددة/);
  assert.match(html,/اختر فعالية/);
  assert.match(html,/منح للفعالية/);
  assert.match(html,/فعالية سبتمبر/);
  assert.doesNotMatch(html,/>eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee</);
  const select=runtime.document.querySelector('[data-resource-for="reservations.booking.view"]');
  select.value=runtime.event;
  runtime.document.querySelector('[data-resource-grant]').click();
  await new Promise((resolve)=>setImmediate(resolve));
  assert.equal(runtime.calls[0].input.resourceType,'event');
  assert.equal(runtime.calls[0].input.resourceId,runtime.event);
});

test('resource-only scope suppresses module-wide grant while preserving event selector',async()=>{
  const runtime=uiRuntime('resource',null);
  await openReservations(runtime);
  const html=runtime.ui.renderSection();
  assert.doesNotMatch(html,/data-business-grant/);
  assert.match(html,/data-resource-grant/);
});

test('module-only Reservations permission grants and revokes without resource',async()=>{
  const runtime=uiRuntime('module',null);
  await openReservations(runtime);
  const button=runtime.document.querySelector('[data-business-grant]');
  assert.ok(button);
  assert.equal(runtime.document.querySelector('[data-resource-grant]'),null);
  button.click();
  await new Promise((resolve)=>setImmediate(resolve));
  assert.equal(runtime.calls[0].input.resourceType,null);
  assert.equal(runtime.calls[0].input.resourceId,null);
});

test('Warehouse store-scoped controls remain metadata-driven',async()=>{
  const runtime=uiRuntime('resource',null);
  await runtime.ui.initialize();
  await runtime.ui.selectModule('warehouse');
  await runtime.ui.search('User');
  await runtime.ui.select(runtime.target);
  const html=runtime.ui.renderSection();
  assert.match(html,/مخزن محدد/);
  assert.match(html,/اختر مخزنًا/);
  assert.match(html,/منح للمخزن/);
});

function lifecycleRuntime(options={}){
  const dom=new JSDOM('<div id="module_permission_administration_screen"></div>');
  const target='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const calls={probe:[],resources:[],grants:[]};
  let reservationsLoad=0;
  const moduleOnly={permissionKey:'reservations.event.create',displayName:'Create Event',description:'',allowedScopeMode:'module',allowedResourceType:null,sensitiveMutation:false};
  const both={permissionKey:'reservations.event.manage',displayName:'Manage Event',description:'',allowedScopeMode:'both',allowedResourceType:'event',sensitiveMutation:false};
  const warehouse={permissionKey:'warehouse.store.view',displayName:'View Store',description:'',allowedScopeMode:'resource',allowedResourceType:'store',sensitiveMutation:false};
  const api={
    isSupportedModule:(key)=>['warehouse','reservations'].includes(key),
    probeAvailability:(moduleKey)=>{
      calls.probe.push(moduleKey);
      if(options.deferredProbe)return options.deferredProbe.promise;
      if(moduleKey==='warehouse')return Promise.resolve({ok:true,data:{ownerConfirmed:true,catalog:[warehouse]}});
      const load=reservationsLoad++;
      if(options.failRefresh&&load>0)return Promise.resolve({ok:false,error:{code:'REFRESH_FAILED'}});
      const catalog=load===0?[moduleOnly]:[both,moduleOnly];
      return Promise.resolve({ok:true,data:{ownerConfirmed:true,catalog}});
    },
    listResources:(moduleKey,type)=>{
      calls.resources.push({moduleKey,type});
      const sequence=calls.resources.filter((item)=>item.moduleKey===moduleKey&&item.type===type).length;
      const resourceId=sequence===1?'11111111-1111-4111-8111-111111111111':'22222222-2222-4222-8222-222222222222';
      return Promise.resolve({ok:true,data:{resources:[{resourceId,resourceType:type,code:sequence===1?'OLD':'NEW',name:sequence===1?'Old Event':'New Event'}]}});
    },
    searchCandidates:()=>Promise.resolve({ok:true,data:{candidates:[{userId:target,displayName:'User',email:'user@example.invalid',accountStatus:'approved'}]}}),
    listGrants:(moduleKey,userId)=>{calls.grants.push({moduleKey,userId});return Promise.resolve({ok:true,data:{grants:[]}});},
    foundationMutation:()=>Promise.resolve({ok:false}),catalogMutation:()=>Promise.resolve({ok:false})
  };
  dom.window.ModulePermissionAdministrationService=api;
  dom.window.confirm=()=>true;
  vm.runInContext(uiSource,vm.createContext(dom.window));
  return {ui:dom.window.ModulePermissionAdministrationUI,calls,target};
}

test('reopening refreshes module-only catalog into authoritative Event controls and selected grants',async()=>{
  const runtime=lifecycleRuntime();
  await runtime.ui.selectModule('reservations');
  await runtime.ui.search('User');
  await runtime.ui.select(runtime.target);
  const initial=runtime.ui.renderSection();
  assert.match(initial,/reservations\.event\.create/);
  assert.doesNotMatch(initial,/data-resource-grant/);
  assert.equal(runtime.calls.grants.length,1);
  await runtime.ui.initialize();
  const refreshed=runtime.ui.renderSection();
  assert.match(refreshed,/data-business-grant[^>]*data-permission="reservations\.event\.manage"/);
  assert.match(refreshed,/data-resource-for="reservations\.event\.manage"/);
  assert.match(refreshed,/data-resource-grant[^>]*data-permission="reservations\.event\.manage"/);
  assert.match(refreshed,/OLD — Old Event/);
  assert.match(refreshed,/reservations\.event\.create/);
  assert.equal(runtime.calls.grants.length,2);
});

test('each completed reopen replaces resource snapshots instead of accumulating them',async()=>{
  const runtime=lifecycleRuntime();
  await runtime.ui.selectModule('reservations');
  await runtime.ui.initialize();
  await runtime.ui.search('User');
  await runtime.ui.select(runtime.target);
  assert.match(runtime.ui.renderSection(),/OLD — Old Event/);
  await runtime.ui.initialize();
  const refreshed=runtime.ui.renderSection();
  assert.match(refreshed,/NEW — New Event/);
  assert.doesNotMatch(refreshed,/OLD — Old Event/);
});

test('repeated initialize calls share one in-flight authoritative load',async()=>{
  let resolveProbe;
  const deferredProbe={promise:new Promise((resolve)=>{resolveProbe=resolve;})};
  const runtime=lifecycleRuntime({deferredProbe});
  const first=runtime.ui.initialize(),second=runtime.ui.initialize();
  assert.equal(first,second);
  assert.equal(runtime.calls.probe.length,1);
  resolveProbe({ok:true,data:{ownerConfirmed:true,catalog:[]}});
  assert.equal(await first,true);
});

test('module switching still reloads Warehouse resource metadata after Reservations refresh',async()=>{
  const runtime=lifecycleRuntime();
  await runtime.ui.selectModule('reservations');
  await runtime.ui.initialize();
  await runtime.ui.selectModule('warehouse');
  await runtime.ui.search('User');
  await runtime.ui.select(runtime.target);
  const rendered=runtime.ui.renderSection();
  assert.match(rendered,/warehouse\.store\.view/);
  assert.match(rendered,/data-resource-type="store"/);
  assert.match(rendered,/منح للمخزن/);
  assert.equal(runtime.calls.probe.at(-1),'warehouse');
});

test('failed protected reopen fails closed without presenting stale permissions as current',async()=>{
  const runtime=lifecycleRuntime({failRefresh:true});
  await runtime.ui.selectModule('reservations');
  await runtime.ui.search('User');
  await runtime.ui.select(runtime.target);
  assert.match(runtime.ui.renderSection(),/reservations\.event\.create/);
  assert.equal(await runtime.ui.initialize(),false);
  const failed=runtime.ui.renderSection();
  assert.match(failed,/هذه الشاشة غير متاحة/);
  assert.doesNotMatch(failed,/reservations\.event\.create|reservations\.event\.manage|data-resource-grant/);
});
