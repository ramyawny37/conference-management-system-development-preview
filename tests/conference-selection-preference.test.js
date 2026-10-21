'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const test=require('node:test');
const source=fs.readFileSync('state.js','utf8');
function extract(name){
  const start=source.indexOf('function '+name+'(');assert.notEqual(start,-1,name);
  let at=source.indexOf('{',start),depth=0,quote='',escape=false;
  for(;at<source.length;at++){const ch=source[at];if(quote){if(escape)escape=false;else if(ch==='\\')escape=true;else if(ch===quote)quote='';continue;}if(ch==='\''||ch==='"'||ch==='`'){quote=ch;continue;}if(ch==='{')depth++;else if(ch==='}'&&!--depth)return source.slice(start,at+1);}
  throw new Error(name);
}
function runtime(userId='user-a',deviceId='device-a'){
  const values=new Map();
  const context={window:null,String,localStorage:{getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)},browserStorageNamespace:{key:name=>'dev:'+name},applicationStorageState:{},applicationSelectionRestored:true,storageInitializationPromise:{},appData:{currentConferenceId:'conference-a'},currentConferenceRuntimeActivationDecision:{ok:true}};
  context.window=context;context.SupabaseAuth={getAccountIdentity:()=>({userId})};context.PlatformIntegration={getDeviceIdentity:()=>({id:deviceId})};
  vm.runInNewContext(['conferenceSelectionPreferenceKey','readConferenceSelectionPreference','persistConferenceSelectionPreference','resetConferenceRuntimeSelection'].map(extract).join('\n'),context);
  return {context,values};
}
test('selection preference is isolated by environment, account, and device',()=>{
  const first=runtime();assert.equal(first.context.persistConferenceSelectionPreference('conference-a'),true);
  assert.equal(first.context.readConferenceSelectionPreference(),'conference-a');
  assert.equal([...first.values.keys()][0],'dev:conference_selection:user-a:device-a');
  assert.notEqual(runtime('user-b','device-a').context.conferenceSelectionPreferenceKey(),first.context.conferenceSelectionPreferenceKey());
  assert.notEqual(runtime('user-a','device-b').context.conferenceSelectionPreferenceKey(),first.context.conferenceSelectionPreferenceKey());
});
test('session reset clears runtime activation but does not manufacture authority',()=>{
  const state=runtime();state.context.resetConferenceRuntimeSelection();
  assert.equal(state.context.appData.currentConferenceId,null);
  assert.equal(state.context.currentConferenceRuntimeActivationDecision,null);
  assert.equal(state.context.applicationPersistedConferenceCandidate,null);
  assert.equal(state.context.storageInitializationPromise,null);
});
test('legacy appData selection is not the startup restoration source',()=>{
  assert.match(source,/applicationPersistedConferenceCandidate=\s*readConferenceSelectionPreference\(\)/);
  assert.doesNotMatch(source,/applicationPersistedConferenceCandidate=\s*String\(selection\.data\.currentConferenceId/);
});
