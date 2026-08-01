'use strict';

var assert=require('assert');
var fs=require('fs');
var path=require('path');
var vm=require('vm');
var utilsSource=fs.readFileSync(path.resolve(__dirname,'../js/sync/organization-administration-utils.js'),'utf8');
var serviceSource=fs.readFileSync(path.resolve(__dirname,'../js/supabase/organization-administration-service.js'),'utf8');
var repositorySource=fs.readFileSync(path.resolve(__dirname,'../js/sync/organization-membership-operation-repository.js'),'utf8');
var indexedDbSource=fs.readFileSync(path.resolve(__dirname,'../js/storage/indexeddb.js'),'utf8');
var uiSource=fs.readFileSync(path.resolve(__dirname,'../js/sync/organization-members-ui.js'),'utf8');
var applicationSource=fs.readFileSync(path.resolve(__dirname,'../script.js'),'utf8');
var roleVariableFixMigrationSource=fs.readFileSync(path.resolve(__dirname,'../supabase/migrations/20260801_5_3_3_organization_access_role_variable_fix.sql'),'utf8');
var memberListRoleVariableFixMigrationSource=fs.readFileSync(path.resolve(__dirname,'../supabase/migrations/20260801_5_3_4_organization_member_list_role_variable_fix.sql'),'utf8');
var ids={actor:'11111111-1111-4111-8111-111111111111',other:'22222222-2222-4222-8222-222222222222',organization:'33333333-3333-4333-8333-333333333333',target:'44444444-4444-4444-8444-444444444444',operation:'55555555-5555-4555-8555-555555555555'};
function delay(ms){return new Promise(function(resolve){setTimeout(resolve,ms);});}
function deferred(){var resolve;var promise=new Promise(function(done){resolve=done;});return {promise:promise,resolve:resolve};}
function key(record){return [record.authenticatedUserId,record.organizationId,record.targetUserId,record.action,record.requestedRole||''].join('|');}
function runtime(settings){
  settings=settings||{};var records=Object.create(null),calls=[],refreshes=0;
  var repository={
    prepare:function(input,operationId){var k=key(input);if(!records[k])records[k]=Object.assign({},input,{operationId:operationId,state:'pending',createdAt:'2026-08-01T00:00:00.000Z',lastAttemptAt:null,attemptCount:0});return Promise.resolve({ok:true,status:'prepared',data:Object.assign({},records[k])});},
    markAttempt:function(user,id){var record=Object.keys(records).map(function(k){return records[k];}).filter(function(item){return item.authenticatedUserId===user&&item.operationId===id;})[0];record.attemptCount++;record.lastAttemptAt='2026-08-01T00:00:00.000Z';return Promise.resolve({ok:true,status:'attempt_recorded',data:record});},
    markUnknown:function(user,id){var record=Object.keys(records).map(function(k){return records[k];}).filter(function(item){return item.authenticatedUserId===user&&item.operationId===id;})[0];record.state='unknown';return Promise.resolve({ok:true,status:'unknown',data:record});},
    remove:function(user,id){Object.keys(records).forEach(function(k){if(records[k].authenticatedUserId===user&&records[k].operationId===id)delete records[k];});return Promise.resolve({ok:true,status:'removed'});},
    listForReconciliation:function(user){return Promise.resolve({ok:true,status:'listed',data:{operations:Object.keys(records).map(function(k){return records[k];}).filter(function(r){return r.authenticatedUserId===user;})}});}
  };
  var elements={organization_members_content:{innerHTML:''},organization_member_lookup_email:{value:'target@example.test'}};
  var sandbox={window:null,Promise:Promise,JSON:JSON,Object:Object,String:String,Number:Number,Array:Array,Math:Math,Date:Date,Uint8Array:Uint8Array,structuredClone:global.structuredClone,setTimeout:setTimeout,clearTimeout:clearTimeout,crypto:{randomUUID:function(){return ids.operation;}},document:{getElementById:function(id){return elements[id]||null;}},SupabaseAuth:{getSession:function(){return {user:{id:settings.actor||ids.actor}};}},SupabaseClientLayer:{getClient:function(){return {rpc:function(name,args){calls.push({name:name,args:args});return settings.rpc(name,args,calls.length);}};}},OrganizationMembershipOperationRepository:repository,console:console};
  sandbox.window=sandbox;vm.runInNewContext(utilsSource,sandbox);vm.runInNewContext(serviceSource,sandbox);vm.runInNewContext(uiSource,sandbox);
  return {service:sandbox.OrganizationAdministrationService,ui:sandbox.OrganizationMembersUI,repository:repository,records:records,calls:calls,elements:elements,options:{repository:repository,auth:sandbox.SupabaseAuth,clientLayer:sandbox.SupabaseClientLayer}};
}
function access(role){return {organization_id:ids.organization,current_user_role:role,can_manage_members:role==='organization_owner'||role==='organization_admin',can_manage_admins:role==='organization_owner',can_manage_owners:role==='organization_owner'};}
async function run(){
  var ownerAccess=runtime({rpc:function(name){
    if(name==='get_my_organization_access')return Promise.resolve({data:access('organization_owner'),error:null});
  }});
  var ownerAccessResult=await ownerAccess.service.getCurrentAccess({organizationId:ids.organization},ownerAccess.options);
  assert.strictEqual(ownerAccessResult.data.role,'organization_owner');
  assert.strictEqual(ownerAccessResult.data.role==='postgres',false);
  assert.deepStrictEqual(JSON.parse(JSON.stringify({
    canManageMembers:ownerAccessResult.data.canManageMembers,
    canManageAdmins:ownerAccessResult.data.canManageAdmins,
    canManageOwners:ownerAccessResult.data.canManageOwners
  })),{canManageMembers:true,canManageAdmins:true,canManageOwners:true});
  var postgresAccess=runtime({rpc:function(name){
    if(name==='get_my_organization_access')return Promise.resolve({data:Object.assign({},access('organization_owner'),{current_user_role:'postgres'}),error:null});
  }});
  assert.strictEqual((await postgresAccess.service.getCurrentAccess({organizationId:ids.organization},postgresAccess.options)).status,'malformed_response');
  assert.ok(/caller_organization_role text/.test(roleVariableFixMigrationSource));
  assert.ok(/select members\.role into caller_organization_role/.test(roleVariableFixMigrationSource));
  assert.strictEqual(/\bcurrent_role\b/.test(roleVariableFixMigrationSource),false);
  assert.ok(/caller_organization_role text/.test(memberListRoleVariableFixMigrationSource));
  assert.ok(/select members\.role into caller_organization_role/.test(memberListRoleVariableFixMigrationSource));
  assert.strictEqual(/\bcurrent_role\b/.test(memberListRoleVariableFixMigrationSource),false);
  var ownerList=runtime({rpc:function(name){
    if(name==='list_organization_members')return Promise.resolve({data:[{
      user_id:ids.actor,display_name:'Owner',role:'organization_owner',
      created_at:'2026-08-01T00:00:00.000Z',is_current_user:true
    }],error:null});
  }});
  var ownerListResult=await ownerList.service.listMembers({organizationId:ids.organization},ownerList.options);
  assert.strictEqual(ownerListResult.status,'listed');
  assert.strictEqual(ownerListResult.data.members[0].role,'organization_owner');
  assert.strictEqual(ownerListResult.data.members[0].isCurrentUser,true);
  var ordinary=runtime({rpc:function(name){if(name==='get_my_organization_access')return Promise.resolve({data:access('member'),error:null});if(name==='list_organization_members')return Promise.resolve({data:null,error:{code:'42501',message:'organization administration role required'}});}});
  var ordinaryAccess=await ordinary.service.getCurrentAccess({organizationId:ids.organization},ordinary.options);assert.strictEqual(ordinaryAccess.data.canManageMembers,false);assert.strictEqual((await ordinary.service.listMembers({organizationId:ids.organization},ordinary.options)).status,'rpc_error');
  var candidate=runtime({rpc:function(name){if(name==='lookup_organization_candidate_by_email')return Promise.resolve({data:{status:'candidate',organization_id:ids.organization,target_user_id:ids.target,display_name:'Target',membership_status:'member'},error:null});}});
  var candidateResult=await candidate.service.lookupCandidate({organizationId:ids.organization,email:'target@example.test'},candidate.options);assert.strictEqual(candidateResult.data.membershipStatus,'member');
  var uniform=runtime({rpc:function(){return Promise.resolve({data:{status:'unavailable',organization_id:ids.organization,target_user_id:null,display_name:null,membership_status:'not_member'},error:null});}});
  assert.strictEqual((await uniform.service.lookupCandidate({organizationId:ids.organization,email:'missing@example.test'},uniform.options)).status,'candidate_unavailable');
  var unavailableExpected={ok:false,status:'candidate_unavailable',data:{organizationId:ids.organization,targetUserId:null,displayName:null,membershipStatus:'not_member'},error:null};
  var malformed=runtime({rpc:function(){return Promise.resolve({data:{status:'candidate',organization_id:'wrong',target_user_id:'bad',membership_status:'bad'},error:null});}});
  var lookupCases=[
    uniform.service.lookupCandidate({organizationId:ids.organization,email:'missing@example.test'},uniform.options),
    malformed.service.lookupCandidate({organizationId:ids.organization,email:'target@example.test'},malformed.options),
    uniform.service.lookupCandidate({organizationId:ids.organization,email:''},uniform.options)
  ];
  for(var lookupIndex=0;lookupIndex<lookupCases.length;lookupIndex++){
    assert.deepStrictEqual(JSON.parse(JSON.stringify(await lookupCases[lookupIndex])),unavailableExpected);
  }
  function uiUnavailableMessage(email,rpc){
    var view=runtime({rpc:rpc});view.elements.organization_members_content.innerHTML=view.ui.renderSection({organizationId:ids.organization});
    return view.ui.refresh().then(function(){view.elements.organization_member_lookup_email.value=email;return view.ui.lookup();}).then(function(){
      return (view.elements.organization_members_content.innerHTML.match(/لا يتوفر مرشح بهذا البريد\./)||[])[0]||'';
    });
  }
  var invalidMessage=await uiUnavailableMessage('',function(name){
    if(name==='get_my_organization_access')return Promise.resolve({data:access('organization_owner'),error:null});
    if(name==='list_organization_members')return Promise.resolve({data:[],error:null});
  });
  var malformedMessage=await uiUnavailableMessage('target@example.test',function(name){
    if(name==='get_my_organization_access')return Promise.resolve({data:access('organization_owner'),error:null});
    if(name==='list_organization_members')return Promise.resolve({data:[],error:null});
    return Promise.resolve({data:{status:'candidate',organization_id:'wrong',target_user_id:'bad',membership_status:'bad'},error:null});
  });
  assert.strictEqual(invalidMessage,malformedMessage);
  var attempts=0;var pending=runtime({rpc:function(name,args){attempts++;if(name==='get_my_organization_access')return Promise.resolve({data:access('organization_owner'),error:null});if(name==='list_organization_members')return Promise.resolve({data:[],error:null});if(attempts===1)return Promise.reject(new Error('network failed'));return Promise.resolve({data:{status:'applied'},error:null});}});
  var first=await pending.service.addMember({organizationId:ids.organization,targetUserId:ids.target},pending.options);assert.strictEqual(first.status,'unknown');var stored=Object.keys(pending.records).map(function(k){return pending.records[k];})[0];assert.strictEqual(stored.state,'unknown');assert.strictEqual(stored.attemptCount,1);var reconciled=await pending.service.reconcilePendingOperations(pending.options);assert.strictEqual(reconciled.status,'reconciled');assert.strictEqual(pending.calls.filter(function(c){return c.name==='add_organization_member';})[0].args.p_operation_id,ids.operation);
  var late=deferred(),mutationCalls=0;var timeout=runtime({rpc:function(name){
    if(name==='get_my_organization_access')return Promise.resolve({data:access('organization_owner'),error:null});
    if(name==='list_organization_members')return Promise.resolve({data:[],error:null});
    if(name==='add_organization_member'){mutationCalls++;return mutationCalls===1?late.promise:Promise.resolve({data:{status:'applied'},error:null});}
  }});
  var timedOut=await timeout.service.addMember({organizationId:ids.organization,targetUserId:ids.target},Object.assign({},timeout.options,{mutationTimeoutMs:5}));
  assert.strictEqual(timedOut.status,'unknown');var timeoutRecord=Object.keys(timeout.records).map(function(k){return timeout.records[k];})[0];assert.strictEqual(timeoutRecord.operationId,ids.operation);assert.strictEqual(timeoutRecord.state,'unknown');
  late.resolve({data:{status:'applied'},error:null});await delay(10);assert.strictEqual(timeoutRecord.state,'unknown');assert.strictEqual(Object.keys(timeout.records).length,1);
  await timeout.service.reconcilePendingOperations(timeout.options);assert.strictEqual(timeout.calls.filter(function(call){return call.name==='add_organization_member';})[1].args.p_operation_id,ids.operation);
  assert.ok(/organization_membership_pending_operations/.test(indexedDbSource));assert.ok(/keyPath:\['authenticatedUserId','operationId'\]/.test(indexedDbSource));['by_authenticated_user','by_user_intent','by_user_created_at','by_created_at'].forEach(function(index){assert.ok(indexedDbSource.indexOf(index)>=0);});
  assert.ok(/createdAt/.test(repositorySource));assert.ok(/FUTURE_TOLERANCE_MS/.test(repositorySource));assert.ok(/store\.delete/.test(repositorySource));assert.ok(/listForReconciliation/.test(repositorySource));
  var gate=deferred();var ui=runtime({rpc:function(name){if(name==='get_my_organization_access')return Promise.resolve({data:access('organization_owner'),error:null});if(name==='list_organization_members')return Promise.resolve({data:[],error:null});if(name==='lookup_organization_candidate_by_email')return Promise.resolve({data:{status:'candidate',organization_id:ids.organization,target_user_id:ids.target,display_name:'Target',membership_status:'not_member'},error:null});if(name==='add_organization_member')return gate.promise;}});
  ui.elements.organization_members_content.innerHTML=ui.ui.renderSection({organizationId:ids.organization});await ui.ui.refresh();await ui.ui.lookup();var add=ui.ui.addMember();assert.ok(ui.elements.organization_members_content.innerHTML.indexOf('disabled')>=0);gate.resolve({data:{status:'applied'},error:null});await add;assert.ok(ui.calls.some(function(call){return call.name==='list_organization_members';}));
  var integration=runtime({rpc:function(name){
    if(name==='list_my_organizations')return Promise.resolve({data:[{id:ids.organization,organization_key:'main',display_name:'المؤسسة الرئيسية',is_default:true}],error:null});
    if(name==='get_my_organization_access')return Promise.resolve({data:access('organization_owner'),error:null});
    if(name==='list_organization_members')return Promise.resolve({data:[],error:null});
  }});
  integration.elements.organization_members_content.innerHTML=integration.ui.renderSection({});await integration.ui.initialize();
  assert.deepStrictEqual(integration.calls.map(function(call){return call.name;}),['list_my_organizations','get_my_organization_access','list_organization_members']);
  assert.ok(integration.elements.organization_members_content.innerHTML.indexOf('إدارة أعضاء المؤسسة')>=0);
  assert.ok(applicationSource.indexOf('h+=window.OrganizationMembersUI.renderSection({});')>=0);
  assert.ok(applicationSource.indexOf('function refreshOrganizationMembersSection()')>=0);
  assert.ok(applicationSource.indexOf('refreshOrganizationMembersSection();')>=0);
  assert.ok(uiSource.indexOf("action:'change_organization_role'")>=0);
  var controls=runtime({rpc:function(name){
    if(name==='get_my_organization_access')return Promise.resolve({data:access('organization_owner'),error:null});
    if(name==='list_organization_members')return Promise.resolve({data:[{user_id:ids.target,display_name:'Target',role:'member',is_current_user:false}],error:null});
    if(name==='remove_organization_member'||name==='change_organization_role')return Promise.resolve({data:{status:'applied'},error:null});
  }});
  controls.elements.organization_members_content.innerHTML=controls.ui.renderSection({organizationId:ids.organization});await controls.ui.refresh();
  await controls.ui.removeMember(ids.target);await controls.ui.changeRole(ids.target,'organization_admin');
  assert.ok(controls.calls.some(function(call){return call.name==='remove_organization_member';}));
  assert.ok(controls.calls.some(function(call){return call.name==='change_organization_role';}));
  assert.strictEqual(serviceSource.indexOf('.from('),-1);assert.strictEqual(serviceSource.indexOf('attemptCount++'),-1);
  console.log('organization administration contract tests: passed');
}
run().catch(function(error){console.error(error);process.exitCode=1;});
