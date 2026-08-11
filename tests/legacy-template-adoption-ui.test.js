'use strict';
const assert=require('assert'),fs=require('fs'),vm=require('vm');
const source=fs.readFileSync('js/sync/legacy-template-adoption-ui.js','utf8');
function element(){return {style:{display:'none'},textContent:'',innerHTML:'',disabled:false};}
const nodes={legacyTemplateAdoptionModal:element(),legacy_template_house_count:element(),legacy_template_conference_count:element(),legacy_template_organizations:element(),legacy_template_adopt_action:element(),legacy_template_adoption_message:element()};
let adopted=null,renders=0,toasts=[];
const roles={};
const window={document:{getElementById:id=>nodes[id]||null},Promise,showToast:text=>toasts.push(text),OrganizationTemplateSync:{getAdoptionState:()=>({status:'idle'}),canAdoptLegacyTemplates:ids=>ids.every(id=>['organization_owner','organization_admin'].includes(roles[id])),adoptLegacyTemplates:ids=>{adopted=ids.slice();return Promise.resolve({ok:true});}},renderSettings(){renders++;}};
window.window=window;vm.runInNewContext(source,{window,Promise});
const ui=window.LegacyTemplateAdoptionUI;
roles['org-a']='organization_owner';roles['org-b']='member';
ui.update({status:'adoption_required',houseCount:2,conferenceCount:1,organizations:[{organizationId:'org-a',displayName:'First',role:'organization_owner'},{organizationId:'org-b',displayName:'Second',role:'member'}]});
assert.equal(nodes.legacyTemplateAdoptionModal.style.display,'flex');
assert(nodes.legacy_template_organizations.innerHTML.includes('type="checkbox"'));
assert(!nodes.legacy_template_organizations.innerHTML.includes('org-b'));
assert.equal(nodes.legacy_template_adopt_action.disabled,true,'multi-org must not auto-select');
ui.toggleOrganization('org-a',true);
assert.equal(nodes.legacy_template_adopt_action.disabled,false);
(async function(){
  await ui.adopt();
  assert.deepEqual(adopted,['org-a']);
  assert.equal(renders,1);
  assert.equal(nodes.legacyTemplateAdoptionModal.style.display,'none');
  adopted=null;
  ui.update({status:'adoption_required',houseCount:1,conferenceCount:0,
    organizations:[{organizationId:'org-b',displayName:'Member',role:'member'}],
    selectedOrganizationIds:[]});
  assert.equal(nodes.legacyTemplateAdoptionModal.style.display,'none');
  ui.toggleOrganization('org-b',true);
  const denied=await ui.adopt();
  assert.equal(denied.status,'not_authorized');
  assert.equal(adopted,null);
  assert(toasts.includes('ليس لديك صلاحية لإتاحة القوالب لهذه المؤسسة.'));
  console.log('legacy template adoption UI tests: PASS');
})().catch(error=>{console.error(error);process.exitCode=1;});
