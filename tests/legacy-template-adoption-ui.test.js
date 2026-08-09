'use strict';
const assert=require('assert'),fs=require('fs'),vm=require('vm');
const source=fs.readFileSync('js/sync/legacy-template-adoption-ui.js','utf8');
function element(){return {style:{display:'none'},textContent:'',innerHTML:'',disabled:false};}
const nodes={legacyTemplateAdoptionModal:element(),legacy_template_house_count:element(),legacy_template_conference_count:element(),legacy_template_organizations:element(),legacy_template_adopt_action:element(),legacy_template_adoption_message:element()};
let adopted=null,renders=0;
const window={document:{getElementById:id=>nodes[id]||null},Promise,OrganizationTemplateSync:{getAdoptionState:()=>({status:'idle'}),adoptLegacyTemplates:ids=>{adopted=ids.slice();return Promise.resolve({ok:true});}},renderSettings(){renders++;}};
window.window=window;vm.runInNewContext(source,{window,Promise});
const ui=window.LegacyTemplateAdoptionUI;
ui.update({status:'adoption_required',houseCount:2,conferenceCount:1,organizations:[{organizationId:'org-a',displayName:'First',role:'owner'},{organizationId:'org-b',displayName:'Second',role:'member'}]});
assert.equal(nodes.legacyTemplateAdoptionModal.style.display,'flex');
assert(nodes.legacy_template_organizations.innerHTML.includes('type="checkbox"'));
assert.equal(nodes.legacy_template_adopt_action.disabled,true,'multi-org must not auto-select');
ui.toggleOrganization('org-a',true);ui.toggleOrganization('org-b',true);
assert.equal(nodes.legacy_template_adopt_action.disabled,false);ui.adopt();
setTimeout(()=>{assert.deepEqual(adopted,['org-a','org-b']);assert.equal(renders,1);assert.equal(nodes.legacyTemplateAdoptionModal.style.display,'none');console.log('legacy template adoption UI tests: PASS');},0);
