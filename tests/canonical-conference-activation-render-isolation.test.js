'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('script.js','utf8');
const start=source.indexOf('function activatePersistedConferenceById(');
const end=source.indexOf('function downloadFullApplicationBackup(',start);
const activation=source.slice(start,end);
test('conference activation distinguishes essential state steps from nonfatal render steps',()=>{
  assert.ok(start>=0&&end>start);
  assert.match(activation,/runMemberActivationRenderStep\('render_accommodation'/);
  assert.match(activation,/runMemberActivationRenderStep\('render_transports'/);
  assert.match(activation,/runMemberActivationRenderStep\('render_settings'/);
  assert.match(activation,/runMemberActivationRenderStep\('render_current_tab'/);
  assert.match(activation,/runMemberActivationStep\(essentialSteps\[stepIndex\]\[0\]/);
});
test('render failures are recorded and never classified as activation failure',()=>{
  const helper=source.slice(source.indexOf('function runMemberActivationRenderStep('),start);
  assert.match(helper,/runMemberActivationStep\(stage,callback\)/);
  assert.match(helper,/console\.error/);
  assert.match(helper,/return true/);
  assert.doesNotMatch(helper,/appData\.currentConferenceId\s*=/);
});

test('runtime render exception remains diagnostic and cannot invalidate activation state',()=>{
  const helperStart=source.indexOf('function runMemberActivationStep(');
  const helperEnd=source.indexOf('function activatePersistedConferenceById(',helperStart);
  const errors=[];
  const state={currentConferenceId:'conference-123'};
  const sandbox={
    memberActivationDiagnosticState:{trace:[],exceptionStage:null,currentStage:null},
    appData:state,
    window:{console:{error:(...args)=>errors.push(args)}},
    traceMemberActivation(stage,status,reason){
      sandbox.memberActivationDiagnosticState.trace.push({stage,status,reason});
    }
  };
  vm.runInNewContext(source.slice(helperStart,helperEnd),sandbox);
  const ok=sandbox.runMemberActivationRenderStep('render_accommodation',()=>{
    throw new Error('SIMULATED_RENDER_FAILURE');
  });
  assert.equal(ok,true);
  assert.equal(state.currentConferenceId,'conference-123');
  assert.equal(sandbox.memberActivationDiagnosticState.exceptionStage,'render_accommodation');
  assert.equal(sandbox.memberActivationDiagnosticState.trace.some(
    x=>x.stage==='render_accommodation'&&x.status==='exception'
  ),true);
  assert.equal(errors.length,1);
  let retries=0;
  assert.equal(sandbox.runMemberActivationRenderStep('render_accommodation',()=>{retries++;}),true);
  assert.equal(retries,1);
  assert.equal(state.currentConferenceId,'conference-123');
});
