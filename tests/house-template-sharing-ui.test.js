'use strict';
const assert=require('assert');
const fs=require('fs');
const vm=require('vm');
const source=fs.readFileSync('js/sync/house-template-sharing-ui.js','utf8');
function runtime(role){
  const nodes={houseTemplateSharingModal:{style:{}},house_template_sharing_name:{textContent:''},house_template_sharing_organizations:{innerHTML:''},house_template_sharing_message:{textContent:''}};
  const template={id:'house',name:'House',accessibleOrganizationIds:[]};
  let calls=0;
  const window={document:{getElementById:id=>nodes[id]||null},appData:{houseTemplates:[template]},Promise,Array,String,
    OrganizationTemplateSync:{getManageableOrganizations:()=>['organization_owner','organization_admin'].includes(role)?[{organizationId:'org',displayName:'Organization',role}]:[],canManageHouseTemplateAccess:()=>['organization_owner','organization_admin'].includes(role),changeHouseTemplateAccess(){calls++;return Promise.resolve({ok:true,status:'granted'});}},renderSettings(){},showToast(){}};
  window.window=window;vm.runInNewContext(source,{window});
  return {window,nodes,template,get calls(){return calls;}};
}
(async function(){
  let env=runtime('organization_owner');
  assert(env.window.HouseTemplateSharingUI.renderAction(env.template).includes('مشاركة مع مؤسسة'));
  assert.strictEqual(env.window.HouseTemplateSharingUI.open('house'),true);
  assert(env.nodes.house_template_sharing_organizations.innerHTML.includes('إتاحة للمؤسسة'));
  assert.strictEqual((await env.window.HouseTemplateSharingUI.apply('org','grant')).ok,true);
  assert.strictEqual(env.calls,1);
  env=runtime('organization_admin');
  assert(env.window.HouseTemplateSharingUI.canShow(env.template));
  env=runtime('member');
  assert.strictEqual(env.window.HouseTemplateSharingUI.renderAction(env.template),'');
  assert.strictEqual(env.window.HouseTemplateSharingUI.open('house'),false);
  assert.strictEqual((await env.window.HouseTemplateSharingUI.apply('org','grant')).status,'sharing_unavailable');
  assert.strictEqual(env.calls,0);
  console.log('house template sharing UI tests passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
