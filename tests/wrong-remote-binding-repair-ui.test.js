'use strict';

const assert=require('assert');

const calls=[];
const elements={wrong_binding_repair_confirmation:{value:'إصلاح'}};
global.document={getElementById(id){return elements[id]||null;}};
global.confirm=()=>true;
global.getCurrentConference=()=>({id:'local-a',name:'Local'});
global.ConferenceLinkStore={get:()=>({remoteConferenceId:'old-remote'})};
global.renderSettings=()=>calls.push('render');
global.WrongRemoteBindingRepairService={
  listOwnerConferences(){calls.push('listOwnerConferences');return Promise.resolve({
    ok:true,data:{conferences:[{token:'conference-token',name:'Correct'}]}
  });},
  listOrganizationMembers(token){calls.push(['listOrganizationMembers',token]);return Promise.resolve({
    ok:true,data:{members:[{token:'member-token',displayName:'Member'}]}
  });},
  addSelectedManager(token){calls.push(['addSelectedManager',token]);return Promise.resolve({
    ok:true,status:'manager_added'
  });},
  repairMemberLink(localId,token){calls.push(['repairMemberLink',localId,token]);return Promise.resolve({
    ok:true,status:'repaired'
  });}
};

const UI=require('../js/sync/wrong-remote-binding-repair-ui.js');

(async function run(){
  assert.match(UI.render(),/WrongRemoteBindingRepairUI\.loadOwnerConferences/);
  await UI.loadOwnerConferences();
  await UI.selectOwnerConference('conference-token');
  UI.selectMember('member-token');
  await UI.addSelectedManager();
  assert.match(UI.render(),/WrongRemoteBindingRepairUI\.repair/);
  await UI.repair();
  assert.ok(calls.some(call=>Array.isArray(call)&&call[0]==='repairMemberLink'&&
    call[1]==='local-a'&&call[2]==='conference-token'));
  ['listOwnerConferences','listOrganizationMembers','addSelectedManager',
    'repairMemberLink'].forEach(name=>{
    assert.strictEqual(typeof global.WrongRemoteBindingRepairService[name],'function',
      'service API '+name);
  });
  console.log('wrong remote binding repair UI tests: passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
