'use strict';
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const source=fs.readFileSync('js/sync/organization-template-sync.js','utf8');
const ORG_A='30000000-0000-4000-8000-000000000001';
const ORG_B='30000000-0000-4000-8000-000000000002';

function runtime(remoteRows,settings){
  settings=settings||{};
  const stores={content:[],access:[]},rpcCalls=[],saveCalls=[];
  const data={houseTemplates:[],templates:[],conferences:[],currentConferenceId:null};
  let sequence=0;
  const client={
    rpc(name,args){
      rpcCalls.push({name,args});
      if(name==='list_shared_organization_templates')return Promise.resolve({data:{status:'success',templates:remoteRows||[]}});
      if(name==='apply_library_template_content_operation'){
        if(settings.failContent>0){settings.failContent--;return Promise.reject({code:'NETWORK_ERROR'});}
        return Promise.resolve({data:{status:args.p_base_revision?'updated':'created',revision:args.p_base_revision+1}});
      }
      if(name==='apply_organization_template_access_operation'){
        if(settings.failAccess>0){settings.failAccess--;return Promise.reject({code:'NETWORK_ERROR'});}
        return Promise.resolve({data:{status:args.p_action==='grant'?'granted':'revoked'}});
      }
      throw new Error('unexpected RPC '+name);
    },
    channel(){return {on(){return this;},subscribe(callback){callback('SUBSCRIBED');return this;},unsubscribe(){}};}
  };
  const window={JSON,Promise,Date,crypto:{randomUUID:()=>`00000000-0000-4000-8000-${String(++sequence).padStart(12,'0')}`},appData:data,localStorage:{setItem(){}},SK:'x',addEventListener(){}};
  window.SupabaseAuth={getState:()=>({authenticated:true,user:{id:'10000000-0000-4000-8000-000000000001'}})};
  window.SupabaseDeviceIdentity={getOrCreate:()=>({id:'20000000-0000-4000-8000-000000000001'})};
  window.SupabaseClientLayer={getClient:()=>client};
  window.SystemAccessService={getState:()=>({
    authenticated:true,profileLoaded:true,fresh:true,
    accountStatus:'approved',isSystemOwner:settings.systemOwner===true
  })};
  window.OrganizationManagementService={list:()=>Promise.resolve({ok:true,data:{organizations:settings.organizations||[{organizationId:ORG_A,status:'active',displayName:'A',role:'organization_admin'},{organizationId:ORG_B,status:'active',displayName:'B',role:'organization_owner'}]}})};
  window.AppIndexedDB={stores:{libraryTemplateContentOperations:'content',organizationTemplateAccessOperations:'access'},getAllRecords:name=>Promise.resolve(stores[name].slice()),putRecord:(name,row)=>{const i=stores[name].findIndex(x=>x.operationId===row.operationId);if(i<0)stores[name].push(row);else stores[name][i]=row;return Promise.resolve();},deleteRecord:(name,id)=>{const i=stores[name].findIndex(x=>x.operationId===id);if(i>=0)stores[name].splice(i,1);return Promise.resolve();}};
  window.StorageRepository={getAppSnapshot:()=>Promise.resolve({data:window.appData}),saveAppSnapshot:(value,options)=>{saveCalls.push(options);window.appData=value;return Promise.resolve({ok:true});}};
  vm.runInNewContext(source,{window,console});
  return {window,stores,rpcCalls,saveCalls};
}

(async()=>{
  let r=runtime([{templateType:'house',templateId:'shared',payload:{id:'shared',name:'Cloud',floors:[]},revision:4,deletedAt:null,ownerUserId:'10000000-0000-4000-8000-000000000001',accessibleOrganizationIds:[ORG_A,ORG_B]}]);
  await r.window.OrganizationTemplateSync.refresh();
  assert.equal(r.window.appData.houseTemplates.length,1,'shared identity must materialize once');
  assert.deepEqual(Array.from(r.window.appData.houseTemplates[0].accessibleOrganizationIds),[ORG_A,ORG_B]);
  r.window.appData.houseTemplates[0].name='Edited';
  await r.window.OrganizationTemplateSync.captureLocalSave(r.window.appData);
  await new Promise(resolve=>setTimeout(resolve,0));
  assert(r.rpcCalls.some(call=>call.name==='apply_library_template_content_operation'&&call.args.p_base_revision===4));

  r=runtime([]);r.window.appData.houseTemplates=[{id:'legacy',name:'Legacy',floors:[]}];
  assert.equal(r.window.OrganizationTemplateSync.canEditHouseTemplate('legacy'),true,
    'ownerless local-only template remains editable');
  const refreshed=await r.window.OrganizationTemplateSync.refresh();
  assert.equal(refreshed.status,'adoption_required');
  assert.equal(r.rpcCalls.filter(call=>call.name.includes('apply_')).length,0,'refresh must not adopt implicitly');
  const adopted=await r.window.OrganizationTemplateSync.adoptLegacyTemplates([ORG_A,ORG_B]);
  assert.equal(adopted.ok,true);
  assert.equal(r.rpcCalls.filter(call=>call.name==='apply_library_template_content_operation').length,1,'content is created once');
  assert.equal(r.rpcCalls.filter(call=>call.name==='apply_organization_template_access_operation').length,2,'one association per selected organization');
  assert.deepEqual(Array.from(r.window.appData.houseTemplates[0].accessibleOrganizationIds),[ORG_A,ORG_B]);
  assert(r.saveCalls.every(options=>options&&options.skipSyncQueue===true&&options.skipTemplateSync===true));
  await r.window.OrganizationTemplateSync.adoptLegacyTemplates([ORG_A,ORG_B]);
  assert.equal(r.rpcCalls.filter(call=>call.name==='apply_library_template_content_operation').length,1,'replay is idempotent');

  r=runtime([],{organizations:[]});r.window.appData.houseTemplates=[{id:'no-org',name:'No organization'}];
  assert.equal((await r.window.OrganizationTemplateSync.refresh()).status,'organization_scope_missing');
  assert.equal((await r.window.OrganizationTemplateSync.adoptLegacyTemplates([ORG_A])).status,'organization_selection_required');

  r=runtime([]);r.window.appData.houseTemplates=[{name:'No ID',floors:[]}];r.window.appData.templates=[{id:'conference',name:'Conference'}];
  await r.window.OrganizationTemplateSync.refresh();
  await r.window.OrganizationTemplateSync.adoptLegacyTemplates([ORG_A]);
  assert(r.window.appData.houseTemplates[0].id,'legacy identity must be stable before queueing');
  assert.equal(r.rpcCalls.filter(call=>call.name==='apply_library_template_content_operation'&&call.args.p_template_type==='conference').length,1);
  assert.equal(r.window.appData.conferences.length,0,'template adoption must not mutate conferences');

  r=runtime([],{failAccess:1});r.window.appData.houseTemplates=[{id:'retry',name:'Retry'}];
  await r.window.OrganizationTemplateSync.refresh();
  const partial=await r.window.OrganizationTemplateSync.adoptLegacyTemplates([ORG_A,ORG_B]);
  assert.equal(partial.status,'adoption_partial');
  assert.equal(r.stores.content.length,0);
  assert.equal(r.stores.access.length,1);
  const replay=await r.window.OrganizationTemplateSync.adoptLegacyTemplates([ORG_A,ORG_B]);
  assert.equal(replay.ok,true);
  assert.equal(r.stores.access.length,0);
  assert.deepEqual(Array.from(r.window.appData.houseTemplates[0].accessibleOrganizationIds).sort(),[ORG_A,ORG_B]);

  r=runtime([],{failContent:1});r.window.appData.houseTemplates=[{id:'blocked',name:'Blocked'}];
  await r.window.OrganizationTemplateSync.refresh();
  const blocked=await r.window.OrganizationTemplateSync.adoptLegacyTemplates([ORG_A]);
  assert.equal(blocked.status,'adoption_partial');
  assert.equal(r.rpcCalls.filter(call=>call.name==='apply_organization_template_access_operation').length,0,'failed content must never receive access associations');

  r=runtime([],{organizations:[{
    organizationId:ORG_A,status:'active',displayName:'Member',role:'member'
  }]});
  r.window.appData.houseTemplates=[{id:'member-blocked',name:'Must Stay',
    cloudSyncStatus:'synced',accessibleOrganizationIds:[]}];
  r.stores.access.push({operationId:'existing-unknown',
    templateType:'house',templateId:'member-blocked',action:'grant',
    organizationId:ORG_A,status:'unknown',lastErrorCode:'42501',
    createdAt:'2026-08-11T00:00:00.000Z'});
  await r.window.OrganizationTemplateSync.refresh();
  assert.equal(r.rpcCalls.filter(call=>
    call.name==='apply_organization_template_access_operation').length,0);
  assert.equal(r.stores.access.length,1);
  assert.equal(r.stores.access[0].status,'unknown');
  const beforeMember=JSON.stringify(r.window.appData);
  const beforeSaves=r.saveCalls.length;
  const beforeRpc=r.rpcCalls.length;
  const memberResult=await r.window.OrganizationTemplateSync
    .adoptLegacyTemplates([ORG_A]);
  assert.equal(memberResult.status,'not_authorized');
  assert.equal(JSON.stringify(r.window.appData),beforeMember);
  assert.equal(r.saveCalls.length,beforeSaves);
  assert.equal(r.rpcCalls.length,beforeRpc);
  assert.equal(r.stores.content.length,0);
  assert.equal(r.stores.access.length,1);
  assert.equal(r.stores.access[0].operationId,'existing-unknown');

  r=runtime([]);r.window.appData.houseTemplates=[{id:'previously-cloud',name:'Old',accessibleOrganizationIds:[ORG_A],cloudRevision:2}];
  await r.window.OrganizationTemplateSync.refresh();
  assert.equal(r.window.appData.houseTemplates.length,0,'loss of all visible associations removes cloud materialization');
  assert(r.window.OrganizationTemplateSync.getDiagnostics().some(row=>row.stage==='REALTIME_STATUS'&&row.data.status==='SUBSCRIBED'));

  r=runtime([]);r.window.appData.houseTemplates=[{id:'official',name:'Official',floors:[],accessibleOrganizationIds:[]}];
  await r.window.OrganizationTemplateSync.refresh();
  const officialGrant=await r.window.OrganizationTemplateSync.changeHouseTemplateAccess('official',ORG_A,'grant');
  assert.equal(officialGrant.ok,true,JSON.stringify(officialGrant));
  assert.equal(r.rpcCalls.filter(call=>call.name==='apply_library_template_content_operation').length,1);
  assert.equal(r.rpcCalls.filter(call=>call.name==='apply_organization_template_access_operation').length,1);
  assert.deepEqual(Array.from(r.window.appData.houseTemplates[0].accessibleOrganizationIds),[ORG_A]);
  assert.equal(r.window.appData.houseTemplates[0].accessibleOrganizationIds.indexOf(ORG_B),-1);
  assert.equal(r.window.appData.houseTemplates[0].cloudOwnerUserId,'10000000-0000-4000-8000-000000000001');
  assert.equal(r.window.appData.houseTemplates.length,1,'official grant must preserve identity without duplicates');
  const officialRevoke=await r.window.OrganizationTemplateSync.changeHouseTemplateAccess('official',ORG_A,'revoke');
  assert.equal(officialRevoke.ok,true);
  assert.deepEqual(Array.from(r.window.appData.houseTemplates[0].accessibleOrganizationIds),[]);
  assert.equal(r.window.appData.houseTemplates.length,1,'revoke must retain owner template');
  assert.equal(r.window.appData.houseTemplates[0].cloudOwnerUserId,'10000000-0000-4000-8000-000000000001');

  r=runtime([],{organizations:[{organizationId:ORG_A,status:'active',displayName:'Member',role:'member'}]});
  r.window.appData.houseTemplates=[{id:'member-official',name:'Member',floors:[],accessibleOrganizationIds:[]}];
  await r.window.OrganizationTemplateSync.refresh();
  const memberWrites={saves:r.saveCalls.length,rpcs:r.rpcCalls.length,content:r.stores.content.length,access:r.stores.access.length};
  assert.equal((await r.window.OrganizationTemplateSync.changeHouseTemplateAccess('member-official',ORG_A,'grant')).status,'not_authorized');
  assert.equal((await r.window.OrganizationTemplateSync.changeHouseTemplateAccess('member-official',ORG_A,'revoke')).status,'not_authorized');
  assert.deepEqual({saves:r.saveCalls.length,rpcs:r.rpcCalls.length,content:r.stores.content.length,access:r.stores.access.length},memberWrites);

  r=runtime([]);r.window.appData.houseTemplates=[{id:'not-owned',name:'Other',floors:[],cloudRevision:1,cloudOwnerUserId:'another-user',cloudSyncStatus:'synced',accessibleOrganizationIds:[]}];
  await r.window.OrganizationTemplateSync.refresh();
  assert.equal((await r.window.OrganizationTemplateSync.changeHouseTemplateAccess('not-owned',ORG_A,'grant')).status,'not_authorized');
  assert.equal(r.rpcCalls.filter(call=>call.name.includes('apply_')).length,0);

  r=runtime([]);r.window.appData.houseTemplates=[{id:'ambiguous-cloud',name:'Ambiguous',floors:[],cloudRevision:1,cloudSyncStatus:'synced',accessibleOrganizationIds:[]}];
  assert.equal(r.window.OrganizationTemplateSync.canEditHouseTemplate('ambiguous-cloud'),false,
    'ownerless template carrying cloud metadata must fail closed');

  r=runtime([],{failAccess:1});r.window.appData.houseTemplates=[{id:'failed-official',name:'Failed',floors:[],accessibleOrganizationIds:[]}];
  await r.window.OrganizationTemplateSync.refresh();
  const failedOfficial=await r.window.OrganizationTemplateSync.changeHouseTemplateAccess('failed-official',ORG_A,'grant');
  assert.equal(failedOfficial.status,'access_operation_failed');
  assert.deepEqual(Array.from(r.window.appData.houseTemplates[0].accessibleOrganizationIds),[],'failed RPC must not claim access locally');
  assert.equal(r.window.appData.houseTemplates[0].cloudSyncStatus,'synced','confirmed content remains stable after access failure');
  assert.equal(r.stores.access.length,1);

  r=runtime([{templateType:'house',templateId:'member-shared',payload:{id:'member-shared',name:'Shared for member',floors:[]},revision:3,deletedAt:null,ownerUserId:'owner-user',accessibleOrganizationIds:[ORG_A]}],{organizations:[{organizationId:ORG_A,status:'active',displayName:'Member Org',role:'member'}]});
  await r.window.OrganizationTemplateSync.refresh();
  assert.equal(r.window.appData.houseTemplates.length,1,'member must receive organization-shared template');
  assert.equal(r.window.OrganizationTemplateSync.getManageableOrganizations('member-shared').length,0,'member must not manage shared access');
  const memberOperationCount=r.stores.content.length;
  const memberRpcCount=r.rpcCalls.filter(call=>call.name==='apply_library_template_content_operation').length;
  r.window.appData.houseTemplates[0].floors.push({id:'unauthorized-floor',name:'Blocked',rooms:[]});
  const memberCapture=await r.window.OrganizationTemplateSync.captureLocalSave(r.window.appData);
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(memberCapture.status,'unchanged');
  assert.equal(r.stores.content.length,memberOperationCount,'member edit must not create content operation');
  assert.equal(r.rpcCalls.filter(call=>call.name==='apply_library_template_content_operation').length,memberRpcCount,'member edit must not call content RPC');

  const productionIsolation=runtime([]),developmentIsolation=runtime([]);
  developmentIsolation.window.appData.houseTemplates=[{id:'development-only',name:'Development',floors:[],accessibleOrganizationIds:[]}];
  await developmentIsolation.window.OrganizationTemplateSync.refresh();
  await developmentIsolation.window.OrganizationTemplateSync.changeHouseTemplateAccess('development-only',ORG_A,'grant');
  assert.equal(productionIsolation.stores.content.length,0);
  assert.equal(productionIsolation.stores.access.length,0);
  assert.equal(productionIsolation.window.appData.houseTemplates.length,0,'separate namespaced runtime must remain untouched');
  console.log('organization-template-sync: PASS');
})().catch(error=>{console.error(error);process.exit(1);});
