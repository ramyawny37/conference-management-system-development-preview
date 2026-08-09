'use strict';
const assert=require('assert'),fs=require('fs'),vm=require('vm');
const source=fs.readFileSync('js/sync/organization-members-ui.js','utf8');
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222';
function runtime(user,shared,organizations){
  const elements={organization_members_content:{innerHTML:''}},calls=[];
  const localStorage={getItem:key=>Object.prototype.hasOwnProperty.call(shared,key)?shared[key]:null,setItem:(key,value)=>{shared[key]=String(value);},removeItem:key=>{delete shared[key];}};
  const window={Promise,JSON,Object,String,Number,Array,Math,Date,localStorage,document:{getElementById:id=>elements[id]||null},BrowserStorageNamespace:{key:name=>'cms:development:project:'+name},SupabaseAuth:{getState:()=>({user:{id:user}})},OrganizationAdministrationService:{listMyOrganizations:()=>Promise.resolve({ok:true,data:{organizations}}),listPendingOperations:()=>Promise.resolve({ok:true,data:{operations:[]}}),refresh:input=>{calls.push(input.organizationId);return Promise.resolve({ok:true,data:{access:{role:'organization_owner',canManageMembers:true},members:[]}});}}};
  window.window=window;vm.createContext(window);vm.runInContext(source,window);
  return {ui:window.OrganizationMembersUI,elements,calls};
}
(async function(){
  const organizations=[{organizationId:A,displayName:'Default'},{organizationId:B,displayName:'Hayah'}],storage={};
  const first=runtime('user-a',storage,organizations);first.elements.organization_members_content.innerHTML=first.ui.renderSection({});await first.ui.initialize();assert.strictEqual(first.calls.pop(),A);
  await first.ui.selectOrganization(B);assert.strictEqual(first.calls.pop(),B);assert(first.elements.organization_members_content.innerHTML.includes('Hayah'));
  first.elements.organization_members_content.innerHTML=first.ui.renderSection({});await first.ui.initialize();assert.strictEqual(first.calls.pop(),B,'rerender/refresh must retain current administered organization');
  const reloaded=runtime('user-a',storage,organizations);reloaded.elements.organization_members_content.innerHTML=reloaded.ui.renderSection({});await reloaded.ui.initialize();assert.strictEqual(reloaded.calls.pop(),B,'stored selection must survive module reload');
  const otherUser=runtime('user-b',storage,organizations);otherUser.elements.organization_members_content.innerHTML=otherUser.ui.renderSection({});await otherUser.ui.initialize();assert.strictEqual(otherUser.calls.pop(),A,'selection must be isolated by account');
  const invalid=runtime('user-a',storage,[{organizationId:A,displayName:'Default'}]);invalid.elements.organization_members_content.innerHTML=invalid.ui.renderSection({});await invalid.ui.initialize();assert.strictEqual(invalid.calls.pop(),A,'unavailable stored organization must fall back safely');assert.strictEqual(storage['cms:development:project:administered-organization-selection:user-a'],undefined);
  assert(source.includes('BrowserStorageNamespace'));assert(!source.includes('ActiveOrganizationContext'));
  ['OrganizationManagementUI','OrganizationTemplateSync','StartupConferenceDiscovery'].forEach(name=>assert(!source.includes(name),'administered selection must not affect '+name));
  console.log('administered organization selection tests: passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
