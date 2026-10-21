'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const test=require('node:test');
const stateSource=fs.readFileSync('state.js','utf8');
const openSource=fs.readFileSync('js/sync/discovered-conference-open-service.js','utf8');
const conferenceId='8dc1e911-eaa8-427b-9b20-6f67cce433b6';
function extract(name){const start=stateSource.indexOf('function '+name+'(');assert.notEqual(start,-1,name);let at=stateSource.indexOf('{',start),depth=0,quote='',escape=false;for(;at<stateSource.length;at++){const ch=stateSource[at];if(quote){if(escape)escape=false;else if(ch==='\\')escape=true;else if(ch===quote)quote='';continue;}if(ch==='\''||ch==='"'||ch==='`'){quote=ch;continue;}if(ch==='{')depth++;else if(ch==='}'&&!--depth)return stateSource.slice(start,at+1);}throw new Error(name);}
function preferenceRuntime(values,userId='account-a',deviceId='device-a'){
  const c={window:null,String,localStorage:{getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)},browserStorageNamespace:{key:name=>'dev:'+name},applicationStorageState:{},appData:{currentConferenceId:null},applicationSelectionRestored:false,storageInitializationPromise:null,currentConferenceRuntimeActivationDecision:null};c.window=c;c.SupabaseAuth={getAccountIdentity:()=>({userId})};c.PlatformIntegration={getDeviceIdentity:()=>({id:deviceId})};vm.runInNewContext(['conferenceSelectionPreferenceKey','readConferenceSelectionPreference','persistConferenceSelectionPreference'].map(extract).join('\n'),c);return c;
}
for(const route of ['/conference/app/accommodation','/conference/app/transportation','/conference/app/settings'])test('authorized refresh restores '+route+' without local activation authority',async()=>{
  const values=new Map();
  const first=preferenceRuntime(values);assert.equal(first.persistConferenceSelectionPreference(conferenceId),true);
  const second=preferenceRuntime(values);const candidate=second.readConferenceSelectionPreference();assert.equal(candidate,conferenceId);
  let activeRoute=route,activated=null;
  const c={window:null,structuredClone:value=>JSON.parse(JSON.stringify(value)),appData:{conferences:[],currentConferenceId:null},CanonicalConferenceDiscovery:{listAccessibleConferences:()=>Promise.resolve({ok:true,data:{conferences:[{id:conferenceId,name:'Canonical',capabilities:{core:true}}]}})},clearConferenceCanonicalState:()=>true,ConferenceActivationAuthorization:{authorizeCloud:input=>({ok:true,active:true,conferenceId:input.conferenceId,capabilities:input.capabilities})},activatePersistedConferenceById:(id,options)=>{activated={id,options};return true;}};c.window=c;vm.runInNewContext(openSource,c);
  const result=await c.DiscoveredConferenceOpenService.open(candidate,{enterApplication:false});
  assert.equal(result.ok,true);assert.equal(activated.id,conferenceId);assert.equal(activated.options.activationDecision.active,true);assert.equal(activeRoute,route);
});
test('revoked discovery never reactivates the persisted preference',async()=>{
  const c={window:null,structuredClone:value=>JSON.parse(JSON.stringify(value)),CanonicalConferenceDiscovery:{listAccessibleConferences:()=>Promise.resolve({ok:true,data:{conferences:[]}})}};c.window=c;vm.runInNewContext(openSource,c);const result=await c.DiscoveredConferenceOpenService.open(conferenceId);assert.equal(result.status,'access_denied');
});
