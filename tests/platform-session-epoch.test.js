'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const test=require('node:test');
const source=fs.readFileSync('js/platform-integration.js','utf8');

function environment(){
  const listeners={};
  let release;
  const sandbox={
    window:null,
    addEventListener:(name,callback)=>{(listeners[name]??=[]).push(callback);},
    PlatformDeviceSession:{invokeModuleProtected:()=>new Promise(resolve=>{release=resolve;})}
  };
  sandbox.window=sandbox;
  vm.runInNewContext(source,sandbox);
  return {
    services:sandbox.PlatformIntegration.getModuleServices(),
    reset:()=>{for(const callback of listeners['platform-session-reset']||[])callback({type:'platform-session-reset'});},
    respond:value=>release(value),
    hasPending:()=>typeof release==='function'
  };
}

test('late protected response is rejected after platform session reset',async()=>{
  const env=environment();
  const pending=env.services.invokeProtected('conference','get_conference_core',{p_conference_id:'example'});
  await Promise.resolve();
  assert.equal(env.hasPending(),true);
  env.reset();
  env.respond({conferenceId:'example'});
  await assert.rejects(pending,error=>error&&error.code==='PLATFORM_SESSION_STALE');
});

test('protected response is preserved within unchanged session',async()=>{
  const env=environment();
  const pending=env.services.invokeProtected('conference','get_conference_core',{p_conference_id:'example'});
  await Promise.resolve();
  env.respond({conferenceId:'example'});
  const result=await pending;
  assert.equal(result.conferenceId,'example');
});

test('external session reset clears selected conference and rejects stale pending work',async()=>{
  const env=environment();
  env.services.setSelectedConferenceId('old-conference');
  assert.equal(env.services.getSelectedConferenceId(),'old-conference');
  const pending=env.services.invokeProtected('conference','get_conference_core',{});
  await Promise.resolve();
  env.reset();
  assert.equal(env.services.getSelectedConferenceId(),'');
  env.respond({conferenceId:'old-conference'});
  await assert.rejects(pending,error=>error&&error.code==='PLATFORM_SESSION_STALE');
});
