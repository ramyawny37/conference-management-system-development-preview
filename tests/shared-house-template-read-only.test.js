'use strict';
const assert=require('assert');
const fs=require('fs');
const vm=require('vm');
const authSource=fs.readFileSync('js/sync/house-template-content-authorization.js','utf8');
const scriptSource=fs.readFileSync('script.js','utf8');
const houseSource=fs.readFileSync('houseTemplates.js','utf8');
const stateSource=fs.readFileSync('state.js','utf8');
function extract(source,name){const start=source.indexOf('function '+name+'(');assert(start>=0,'missing '+name);const next=source.indexOf('\nfunction ',start+10);return source.slice(start,next<0?source.length:next);}
function authorization(editable){let toasts=[];const template={id:'shared'};const window={appData:{houseTemplates:[template]},OrganizationTemplateSync:{canEditHouseTemplate:()=>editable},showToast:text=>toasts.push(text)};window.window=window;vm.runInNewContext(authSource,{window});return {window,toasts};}
let env=authorization(false);
assert.strictEqual(env.window.HouseTemplateContentAuthorization.canEdit('shared'),false);
assert.strictEqual(env.window.HouseTemplateContentAuthorization.requireEdit('shared'),false);
assert.strictEqual(env.window.HouseTemplateContentAuthorization.requireCopy('shared'),false);
assert.strictEqual(env.toasts[0],'لا يمكنك تعديل هذا القالب لأنه مشترك معك للعرض والاستخدام فقط.');
env=authorization(true);
assert.strictEqual(env.window.HouseTemplateContentAuthorization.requireEdit('shared'),true);

function blockedCall(source,name,globals,args){let touched=false;const sandbox=Object.assign({window:{HouseTemplateContentAuthorization:{requireEdit:()=>false}},appData:{houseTemplates:[]},getHouseTemplateById(){touched=true;throw new Error('LOCAL_READ_AFTER_DENIAL');},ge(){touched=true;throw new Error('DOM_READ_AFTER_DENIAL');},save(){touched=true;throw new Error('WRITE_AFTER_DENIAL');}},globals||{});sandbox.window.window=sandbox.window;vm.runInNewContext(extract(source,name),sandbox);assert.strictEqual(sandbox[name].apply(null,args||[]),false,name+' must reject');assert.strictEqual(touched,false,name+' touched local state');}
blockedCall(scriptSource,'saveTemplateFloor',{templateFloorDialog:{houseId:'shared'}},[]);
blockedCall(scriptSource,'saveTemplateRoom',{templateRoomDialog:{houseId:'shared'}},[]);
blockedCall(scriptSource,'saveHouseTemplate',{editHouseTemplateId:'shared'},[]);
blockedCall(scriptSource,'deleteHouseTemplate',{},['shared']);
blockedCall(scriptSource,'openHouseTemplateEditor',{},['shared']);
blockedCall(houseSource,'ht_deleteFloorFromTemplate',{},['shared','floor']);
blockedCall(houseSource,'ht_deleteRoomFromTemplate',{},['shared','floor','room']);
let duplicateTouched=false;
const duplicateSandbox={window:{HouseTemplateContentAuthorization:{requireCopy:()=>false}},appData:{get houseTemplates(){duplicateTouched=true;throw new Error('READ_AFTER_DENIAL');}},uid(){duplicateTouched=true;},saveTemplateOnly(){duplicateTouched=true;},renderSettings(){duplicateTouched=true;},showToast(){duplicateTouched=true;}};
vm.runInNewContext(extract(scriptSource,'duplicateHouseTemplate'),duplicateSandbox);
assert.strictEqual(duplicateSandbox.duplicateHouseTemplate('shared'),false);
assert.strictEqual(duplicateTouched,false,'shared duplicate must stop before local mutation');

let writes=0;
const saveTemplateSandbox={window:{editHouseTemplateId:null,HouseTemplateContentAuthorization:{requireEdit:()=>false}},save(){writes++;return true;}};
vm.runInNewContext(extract(stateSource,'saveTemplateOnly'),saveTemplateSandbox);
assert.strictEqual(saveTemplateSandbox.saveTemplateOnly({houseTemplateId:'shared'}),false);
assert.strictEqual(writes,0);
saveTemplateSandbox.window.HouseTemplateContentAuthorization.requireEdit=()=>true;
assert.strictEqual(saveTemplateSandbox.saveTemplateOnly({houseTemplateId:'owned'}),true);
assert.strictEqual(writes,1,'owner save path must remain available');

const localOnly={id:'local-only',name:'Local only'};
const deleteSandbox={window:{HouseTemplateContentAuthorization:{requireEdit:()=>true}},appData:{houseTemplates:[localOnly]},selectedHouseTemplateId:'local-only',editHouseTemplateId:null,confirm:()=>true,deepClone:value=>JSON.parse(JSON.stringify(value)),pushTrashItem(){},removeByIdFromArray:(rows,id)=>rows.filter(row=>row.id!==id),saveTemplateOnly:()=>true,renderSettings(){},showToast(){}};
vm.runInNewContext(extract(scriptSource,'deleteHouseTemplate'),deleteSandbox);
deleteSandbox.deleteHouseTemplate('local-only');
assert.strictEqual(deleteSandbox.appData.houseTemplates.length,0,
  'authorized local-only template remains normally deletable');

const details=extract(scriptSource,'renderHouseTemplateDetails');
assert(details.includes('قالب مشترك — للعرض والاستخدام فقط'));
assert(details.indexOf('if (canEditContent)')<details.indexOf('openHouseTemplateEditor'));
assert(details.indexOf('if (canEditContent)')<details.indexOf('deleteHouseTemplate'));
assert(/if \(canEditContent\) \{\s*h \+= '<button class="btn btn-teal btn-sm" onclick="duplicateHouseTemplate/.test(details),
  'shared template copy button must be owner-gated');
assert(!/\.rpc\s*\(/.test(authSource));
console.log('shared house template read-only tests passed');
