'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const test=require('node:test');
const source=fs.readFileSync('script.js','utf8');
function extract(name){
  const marker='function '+name+'(';
  const start=source.indexOf(marker);
  assert.notEqual(start,-1,name+' must exist');
  let brace=source.indexOf('{',start),depth=0,quote='',escape=false;
  for(let i=brace;i<source.length;i++){
    const ch=source[i];
    if(quote){if(escape)escape=false;else if(ch==='\\')escape=true;else if(ch===quote)quote='';continue;}
    if(ch==='\''||ch==='"'||ch==='`'){quote=ch;continue;}
    if(ch==='{')depth++;else if(ch==='}'&&--depth===0)return source.slice(start,i+1);
  }
  throw new Error('unterminated '+name);
}
function element(){return {hidden:false,style:{display:''},classList:{toggle(){}},attributes:{},getAttribute(k){return this.attributes[k];},setAttribute(k,v){this.attributes[k]=v;},removeAttribute(k){delete this.attributes[k];}};}
function runtime(){
  const tabs=Array.from({length:7},()=>element());
  const buttons=Array.from({length:7},(_value,id)=>{const button=element();button.attributes['data-conference-tab']=String(id);return button;});
  const calls=[];
  const document={body:{classList:{toggle(){}}},querySelector(selector){const match=/"(\d+)"/.exec(selector);return match?buttons[Number(match[1])]:null;},querySelectorAll(){return buttons;}};
  const context={window:null,document,currentTab:6,settingsTab:'general',localStorage:{setItem(){}},LAST_APPLICATION_TAB_KEY:'last',CustomEvent:function(){},getValidApplicationTabIds:()=>[0,1,2,3,4,5,6],ge:id=>tabs[Number(id.slice(3))],getApplicationTabIdByName:name=>name==='settings'?6:null,getCurrentConference:()=>({id:'8dc1e911-eaa8-427b-9b20-6f67cce433b6'}),saveApplicationView(){},saveLastTab(){},renderTab:id=>calls.push(id),setConferenceApplicationPathname(){throw new Error('render must not publish routes');},showToast(){},console};
  context.window=context;
  vm.runInNewContext([extract('isValidApplicationTab'),extract('switchTab')].join('\n'),context);
  return {context,tabs,calls};
}
test('an inactive hidden tab remains a valid target and becomes the sole visible tab',()=>{
  const state=runtime();
  state.tabs.forEach((tab,id)=>{tab.hidden=id!==6;tab.style.display=id===6?'':'none';});
  assert.equal(state.context.isValidApplicationTab(0),true);
  assert.equal(state.context.switchTab(0,{preserveRoute:true}),true);
  assert.equal(state.context.currentTab,0);
  assert.deepEqual(state.calls,[0]);
  state.tabs.forEach((tab,id)=>{assert.equal(tab.hidden,id!==0);assert.equal(tab.attributes['aria-hidden'],id===0?'false':'true');});
});
test('rapid transitions keep currentTab, visible content, and renderer target identical',()=>{
  const state=runtime();
  for(const id of [0,6,2,0,6,0]){
    assert.equal(state.context.switchTab(id,{preserveRoute:true}),true);
    assert.equal(state.context.currentTab,id);
    assert.deepEqual(state.tabs.map(tab=>!tab.hidden),state.tabs.map((_tab,index)=>index===id));
  }
  assert.deepEqual(state.calls,[0,6,2,0,6,0]);
});
test('conference route publication has one owner',()=>{
  const integration=fs.readFileSync('js/platform-integration.js','utf8');
  assert.doesNotMatch(source,/function navigateConferenceRoute\s*\(/);
  assert.match(integration,/activeModuleId==='conference'\)\{platformServices\(\)\.navigate\(targetRoute\)/);
});
