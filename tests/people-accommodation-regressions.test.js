'use strict';

var assert=require('assert');
var fs=require('fs');
var path=require('path');
var vm=require('vm');
var root=path.resolve(__dirname,'..');

function extract(source,startName,endName){
  var start=source.indexOf('function '+startName+'(');
  var end=source.indexOf('function '+endName+'(',start);
  assert.ok(start>=0&&end>start,startName+' extraction failed');
  return source.slice(start,end);
}

var peopleSource=fs.readFileSync(path.join(root,'people.js'),'utf8');
var current={peopleDb:{version:'1.0.0',people:[{
  id:'person-1',fullName:'Old Name',church:'Old Church',phone:'111',
  gender:'',age:'',notes:'',createdAt:'2025-01-01T00:00:00.000Z',
  updatedAt:'2025-01-01T00:00:00.000Z'
}]},houses:[]};
var ids=1;
var peopleSandbox={
  getCurrentConference:function(){return current;},
  uid:function(){ids++;return 'person-'+ids;},Date:Date,String:String,
  Array:Array,Object:Object
};
vm.createContext(peopleSandbox);
vm.runInContext(
  extract(peopleSource,'normalizePersonRecord','resolvePersonName'),
  peopleSandbox
);
vm.runInContext(
  extract(peopleSource,'resolvePersonName','personMetaText'),
  peopleSandbox
);
var createdAt=current.peopleDb.people[0].createdAt;
var oldUpdatedAt=current.peopleDb.people[0].updatedAt;
var edited=peopleSandbox.upsertPerson({
  id:'person-1',fullName:'New Name',church:'New Church',phone:'222',
  gender:'female',age:'30',notes:'Updated'
},true);
assert.strictEqual(current.peopleDb.people.length,1);
assert.strictEqual(edited.id,'person-1');
assert.strictEqual(edited.createdAt,createdAt);
assert.strictEqual(edited.fullName,'New Name');
assert.strictEqual(edited.phone,'222');
assert.notStrictEqual(edited.updatedAt,oldUpdatedAt);

current.houses=[{id:'house-1',floors:[{id:'floor-1',rooms:[{
  id:'room-1',guests:[
    {id:'linked-guest',name:'Old Name',personId:'person-1'},
    {id:'guest-1',name:'Brand New Guest',personId:null}
  ],
  children:[]
}]}]}];
peopleSandbox.linkRoomPeopleToDatabase(current);
assert.strictEqual(current.peopleDb.people.length,2);
var linkedGuest=current.houses[0].floors[0].rooms[0].guests[0];
assert.strictEqual(linkedGuest.personId,'person-1');
assert.strictEqual(linkedGuest.name,'New Name');
assert.strictEqual(peopleSandbox.resolvePersonName(linkedGuest.personId,''),'New Name');
var newGuest=current.houses[0].floors[0].rooms[0].guests[1];
assert.ok(newGuest.personId);
assert.strictEqual(current.peopleDb.people[1].fullName,'Brand New Guest');
current.houses[0].floors[0].rooms[0].guests.push({
  id:'guest-2',name:'Brand New Guest',personId:null
});
peopleSandbox.linkRoomPeopleToDatabase(current);
assert.strictEqual(current.peopleDb.people.length,2);
assert.strictEqual(
  current.houses[0].floors[0].rooms[0].guests[2].personId,
  current.peopleDb.people[1].id
);

var housesSource=fs.readFileSync(path.join(root,'houses.js'),'utf8');
var houseSandbox={uid:function(){ids++;return 'generated-'+ids;},String:String,
  Array:Array,parseInt:parseInt};
vm.createContext(houseSandbox);
vm.runInContext(
  extract(housesSource,'updateConferenceHousesFromTemplate','setRoomDisplayedInAccommodation'),
  houseSandbox
);
vm.runInContext(
  extract(housesSource,'ensureAccommodationDisplayState','getAccommodationRoomsPreflight'),
  houseSandbox
);
var template={id:'template-1',name:'Updated House',description:'Updated',floors:[{
  id:'template-floor-1',name:'Updated Floor',rooms:[{
    id:'template-room-1',number:'202',beds:3,extraBeds:1,notes:'Updated room',
    closed:false,closedDay:null
  },{
    id:'template-room-2',number:'203',beds:2,extraBeds:0,notes:'New room',
    closed:false,closedDay:null
  },{
    id:'template-room-3',number:'204',beds:1,extraBeds:0,notes:'Added room',
    closed:false,closedDay:null
  }]
}]};
var conference={houses:[{
  id:'conference-house-1',sourceTemplateId:'template-1',name:'Old House',floors:[{
    id:'conference-floor-1',sourceTemplateFloorId:'template-floor-1',name:'Old Floor',rooms:[{
      id:'conference-room-1',number:'101',beds:2,guests:[{id:'guest-1'}],children:[],
      closed:true,closedDay:2
    },{
      id:'occupied-removed-room',sourceTemplateRoomId:'removed-template-room',
      number:'199',beds:1,guests:[{id:'protected-guest'}],children:[]
    },{
      id:'conference-room-2',number:'203',beds:1,guests:[],children:[]
    }]
  }]
}],accommodationDisplayedRoomIds:['conference-room-1'],
accommodationDisplayStateInitialized:true};
var unrelated=JSON.parse(JSON.stringify(conference));
assert.strictEqual(houseSandbox.updateConferenceHousesFromTemplate(conference,template),1);
var conferenceHouse=conference.houses[0];
var conferenceRoom=conferenceHouse.floors[0].rooms[0];
assert.strictEqual(conferenceHouse.name,'Updated House');
assert.strictEqual(conferenceHouse.floors[0].name,'Updated Floor');
assert.strictEqual(conferenceRoom.number,'202');
assert.strictEqual(conferenceRoom.beds,3);
assert.strictEqual(conferenceRoom.id,'conference-room-1');
assert.strictEqual(conferenceRoom.guests.length,1);
assert.strictEqual(conferenceRoom.closed,true);
assert.strictEqual(conferenceRoom.closedDay,2);
assert.strictEqual(conferenceHouse.floors[0].rooms.length,4);
assert.strictEqual(conferenceHouse.floors[0].rooms[1].id,'conference-room-2');
assert.strictEqual(conferenceHouse.floors[0].rooms[1].number,'203');
assert.strictEqual(conferenceHouse.floors[0].rooms[1].sourceTemplateRoomId,
  'template-room-2');
assert.strictEqual(conferenceHouse.floors[0].rooms[2].number,'204');
assert.strictEqual(conferenceHouse.floors[0].rooms[2].sourceTemplateRoomId,
  'template-room-3');
assert.strictEqual(conferenceHouse.floors[0].rooms[3].id,'occupied-removed-room');
assert.strictEqual(conferenceHouse.floors[0].rooms[3].guests[0].id,'protected-guest');
assert.deepStrictEqual(Array.from(conference.accommodationDisplayedRoomIds),
  ['conference-room-1']);
assert.strictEqual(houseSandbox.ensureAccommodationDisplayState(conference)[
  conferenceHouse.floors[0].rooms[2].id
],undefined);
assert.strictEqual(unrelated.houses[0].floors[0].rooms[0].number,'101');
assert.strictEqual(template.floors[0].rooms[0].number,'202');
var currentBeforeOtherTemplate=JSON.stringify(conference);
assert.strictEqual(houseSandbox.updateConferenceHousesFromTemplate(conference,{
  id:'template-2',name:'Other',floors:[]
}),0);
assert.strictEqual(JSON.stringify(conference),currentBeforeOtherTemplate);

var scriptSource=fs.readFileSync(path.join(root,'script.js'),'utf8');
var houseTemplatesSource=fs.readFileSync(path.join(root,'houseTemplates.js'),'utf8');
function functionBody(source,name,nextName){
  return extract(source,name,nextName);
}
assert.ok(functionBody(scriptSource,'saveTemplateFloor','renderTemplateRoomModal')
  .indexOf('refreshConferenceHouseAfterTemplateMutation(house)')<0);
assert.ok(functionBody(scriptSource,'saveTemplateRoom','saveSettings')
  .indexOf('refreshConferenceHouseAfterTemplateMutation(house)')<0);
assert.ok(functionBody(houseTemplatesSource,'ht_deleteRoomFromTemplate','ht_roomHtml')
  .indexOf('refreshConferenceHouseAfterTemplateMutation(house)')<0);
assert.ok(houseTemplatesSource.slice(
  houseTemplatesSource.indexOf('function ht_deleteFloorFromTemplate(')
)
  .indexOf('refreshConferenceHouseAfterTemplateMutation(house)')<0);
assert.ok(scriptSource.indexOf(
  'current.houses = deepClone(editRoomData.draftHouses);\n  linkRoomPeopleToDatabase(current);'
)>=0);
assert.ok(scriptSource.indexOf(
  'updateConferenceHousesFromTemplate(currentConference, template)'
)>=0);
assert.ok(scriptSource.indexOf(
  "activeRoomsModal.style.display !== 'none'"
)>=0);

var activeContainer={innerHTML:''};
var managerSandbox={
  activeRoomsManager:{houseId:'conference-house-1'},
  getCurrentConference:function(){return conference;},
  getHouseById:function(){return conferenceHouse;},
  ge:function(id){return id==='active_rooms_container'?activeContainer:null;},
  ensureAccommodationDisplayState:houseSandbox.ensureAccommodationDisplayState,
  getAvailableTemplateRoomsForConferenceHouse:function(){return [];},
  esc:function(value){return String(value);}
};
vm.createContext(managerSandbox);
vm.runInContext(
  extract(scriptSource,'renderActiveRoomsManager','toggleActiveRoom'),
  managerSandbox
);
managerSandbox.renderActiveRoomsManager();
assert.ok(activeContainer.innerHTML.indexOf('204')>=0);
var addedRoomCheckbox='toggleActiveRoom(\''+
  conferenceHouse.floors[0].rooms[2].id+'\', this.checked)';
var addedRoomPosition=activeContainer.innerHTML.indexOf(addedRoomCheckbox);
assert.ok(addedRoomPosition>=0);
assert.strictEqual(activeContainer.innerHTML.slice(
  Math.max(0,addedRoomPosition-150),addedRoomPosition
).indexOf('checked'),-1);

console.log('people and accommodation regression tests: passed');
