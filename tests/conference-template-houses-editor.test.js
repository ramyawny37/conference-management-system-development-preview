'use strict';

var assert=require('assert');
var fs=require('fs');
var path=require('path');
var vm=require('vm');
var root=path.resolve(__dirname,'..');
var source=fs.readFileSync(path.join(
  root,'js/conference-template-houses-editor.js'
),'utf8');

function plain(value){return JSON.parse(JSON.stringify(value));}
function environment(){
  var ids=0,saves=[],forbiddenCalls=0;
  var elements={
    conferenceTemplateHousesEditorBody:{innerHTML:''}
  };
  var modal=null;
  var document={
    body:{appendChild:function(value){modal=value;elements[value.id]=value;}},
    getElementById:function(id){return elements[id]||null;},
    createElement:function(){return {
      id:'',className:'',style:{display:'none'},innerHTML:'',onclick:null
    };}
  };
  var appData={
    currentConferenceId:'conference-1',
    conferences:[{id:'conference-1',name:'Current',houses:[{id:'real-house'}]}],
    houseTemplates:[{id:'library-house',name:'Library',floors:[]}],
    templates:[{
      id:'template-1',name:'Conference Template',
      data:{houses:[],transports:[{id:'transport-1'}]}
    }]
  };
  var sandbox={
    window:null,document:document,appData:appData,
    JSON:JSON,Object:Object,String:String,Array:Array,Date:Date,
    Math:Math,Number:Number,parseInt:parseInt,
    structuredClone:function(value){return plain(value);},
    uid:function(){ids++;return 'generated-'+ids;},
    save:function(options){saves.push(plain(options));return true;},
    confirm:function(){return true;},prompt:function(){return null;},
    getCurrentConference:function(){forbiddenCalls++;throw new Error('FORBIDDEN');},
    getHouseById:function(){forbiddenCalls++;throw new Error('FORBIDDEN');},
    openActiveRoomsManager:function(){forbiddenCalls++;throw new Error('FORBIDDEN');},
    renderAccommodation:function(){forbiddenCalls++;throw new Error('FORBIDDEN');}
  };
  sandbox.window=sandbox;
  vm.runInNewContext(source,sandbox,{
    filename:'conference-template-houses-editor.js'
  });
  return {sandbox:sandbox,appData:appData,saves:saves,
    forbiddenCalls:function(){return forbiddenCalls;},
    body:elements.conferenceTemplateHousesEditorBody,
    modal:function(){return modal;}};
}

var env=environment();
var api=env.sandbox.ConferenceTemplateHousesEditor;
var conferencesBefore=plain(env.appData.conferences);
var libraryBefore=plain(env.appData.houseTemplates);
var currentIdBefore=env.appData.currentConferenceId;

assert.strictEqual(api.open('template-1'),true);
assert.strictEqual(env.appData.currentConferenceId,currentIdBefore);
assert.ok(env.body.innerHTML.indexOf('لا توجد بيوت في القالب')>=0);
assert.strictEqual(env.sandbox.editingConferenceTemplateId,'template-1');

assert.strictEqual(api.addHouse({name:'House A',description:'Desc'}),true);
var template=env.appData.templates[0];
assert.strictEqual(template.data.houses.length,1);
var house=template.data.houses[0];
assert.strictEqual(house.name,'House A');
assert.ok(env.body.innerHTML.indexOf('لا توجد أدوار داخل البيت')>=0);

assert.strictEqual(api.updateHouse(house.id,{name:'House B',description:'Updated'}),true);
assert.strictEqual(house.name,'House B');
assert.strictEqual(house.description,'Updated');

assert.strictEqual(api.addFloor(house.id,{name:'First'}),true);
var floor=house.floors[0];
assert.ok(env.body.innerHTML.indexOf('لا توجد غرف داخل الدور')>=0);
assert.strictEqual(api.updateFloor(house.id,floor.id,{name:'Ground'}),true);
assert.strictEqual(floor.name,'Ground');

assert.strictEqual(api.addRoom(house.id,floor.id,{
  number:'101',beds:2,extraBeds:1,notes:'Near lift',
  closed:true,closedDay:3
}),true);
var room=floor.rooms[0];
assert.deepStrictEqual(plain({
  number:room.number,beds:room.beds,extraBeds:room.extraBeds,
  notes:room.notes,closed:room.closed,closedDay:room.closedDay
}),{
  number:'101',beds:2,extraBeds:1,notes:'Near lift',
  closed:true,closedDay:3
});
assert.strictEqual(api.updateRoom(house.id,floor.id,room.id,{
  number:'102',beds:4,extraBeds:2,notes:'Updated',
  closed:false,closedDay:9
}),true);
assert.deepStrictEqual(plain({
  number:room.number,beds:room.beds,extraBeds:room.extraBeds,
  notes:room.notes,closed:room.closed,closedDay:room.closedDay
}),{
  number:'102',beds:4,extraBeds:2,notes:'Updated',
  closed:false,closedDay:null
});

assert.strictEqual(api.removeRoom(house.id,floor.id,room.id,true),true);
assert.strictEqual(floor.rooms.length,0);
assert.strictEqual(api.removeFloor(house.id,floor.id,true),true);
assert.strictEqual(house.floors.length,0);
assert.strictEqual(api.removeHouse(house.id,true),true);
assert.strictEqual(template.data.houses.length,0);

assert.deepStrictEqual(plain(env.appData.conferences),conferencesBefore);
assert.deepStrictEqual(plain(env.appData.houseTemplates),libraryBefore);
assert.strictEqual(env.appData.currentConferenceId,currentIdBefore);
assert.strictEqual(env.forbiddenCalls(),0);
assert.ok(env.saves.length>=9);
env.saves.forEach(function(options){
  assert.deepStrictEqual(options,{
    skipCurrentConferenceUpdate:true,
    skipConferenceTracking:true,
    skipSyncQueue:true
  });
});

api.close();
assert.strictEqual(env.sandbox.editingConferenceTemplateId,null);
assert.strictEqual(env.modal().style.display,'none');
assert.strictEqual(api.open('missing-template'),false);
assert.strictEqual(env.sandbox.editingConferenceTemplateId,null);

assert.strictEqual(api.open('template-1'),true);
env.appData.templates=[];
api.handleTemplateDeleted('template-1');
assert.strictEqual(env.sandbox.editingConferenceTemplateId,null);
assert.strictEqual(env.modal().style.display,'none');

[
  'getCurrentConference','openActiveRoomsManager','renderAccommodation',
  'getHouseById','accommodationDisplayedRoomIds','addActivityLog',
  'ConferenceLinkStore','ConferenceRealtimeManager','AutomaticQueueRunner'
].forEach(function(forbidden){
  assert.strictEqual(source.indexOf(forbidden),-1,
    'editor must not depend on '+forbidden);
});
var scriptSource=fs.readFileSync(path.join(root,'script.js'),'utf8');
assert.ok(scriptSource.indexOf('إدارة بيوت وغرف القالب')>=0);
assert.ok(scriptSource.indexOf(
  'ConferenceTemplateHousesEditor.open('
)>=0);
var indexSource=fs.readFileSync(path.join(root,'index.html'),'utf8');
assert.ok(indexSource.indexOf(
  '<script src="js/conference-template-houses-editor.js"></script>'
)>=0);

console.log('conference template houses editor tests: passed');
