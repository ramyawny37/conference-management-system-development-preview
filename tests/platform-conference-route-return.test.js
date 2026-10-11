'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync('js/platform-integration.js', 'utf8');

test('returning from Reservations restores the authorized Conference workspace route', async () => {
  let route = '/conference/app/accommodation';
  const pushed = [];
  const window = {
    document: {addEventListener(){},getElementById(){return null;}},
    addEventListener(){},
    history: {pushState(_state,_title,value){pushed.push(value);route=value.slice(1);},replaceState(){}},
    ApplicationRouting: {getLogicalPathname(){return route;},resolveLogicalRoute(value){return '#'+value;}},
    StartupAccessGate: {getState(){return {pipelineState:'completed',applicationVisible:true,gateState:'allowed'};},isAllowed(){return true;}},
    PlatformDeviceSession: {invokeModuleProtected(){return Promise.resolve({status:'allowed'});}},
    openConferenceWorkspace(){return true;},
    reconcileConferenceRoute(){return true;},
    showPlatformModules(){return true;}
  };
  vm.runInNewContext(source,{window,Promise,Object,JSON,String,Error});
  window.PlatformIntegration.registerModule({id:'reservations',mount(){return true;}});
  await window.PlatformIntegration.initialize();
  await window.PlatformIntegration.openModule('reservations');
  await window.PlatformIntegration.openModule('conference');
  assert.equal(route,'/conference/app/accommodation');
  assert.equal(pushed.at(-1),'#/conference/app/accommodation');
});

test('Conference entry retains the original protected authorization boundary', () => {
  assert.match(source,/if\(protectedEntryModules\[id\]\)return enterProtectedModule\(id,targetRoute/);
  assert.match(source,/function enterProtectedModule\(id,route,options,pushRoute\)/);
});
