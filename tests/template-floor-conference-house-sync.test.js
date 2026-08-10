'use strict';

const assert=require('assert');
const fs=require('fs');
const vm=require('vm');

const housesSource=fs.readFileSync('houses.js','utf8');
const scriptSource=fs.readFileSync('script.js','utf8');
function extract(source,start,end){
  const from=source.indexOf('function '+start+'(');
  const to=source.indexOf('function '+end+'(',from);
  assert(from>=0&&to>from,start+' extraction failed');
  return source.slice(from,to);
}

const templateId='11111111-1111-4111-8111-111111111111';
const floorId='22222222-2222-4222-8222-222222222222';
const roomId='33333333-3333-4333-8333-333333333333';
const template={id:templateId,name:'Smoke House',floors:[{
  id:floorId,name:'Fifth',rooms:[{id:roomId,number:'502',beds:2}]
}]};
const conference={houses:[
  {id:'house-a',sourceTemplateId:templateId,floors:[]},
  {id:'house-b',sourceTemplateId:templateId,floors:[{
    id:'existing-conference-floor',sourceTemplateFloorId:floorId,
    name:'Old name',rooms:[{id:'preserved-room',number:'501'}]
  }]},
  {id:'unrelated',sourceTemplateId:'other-template',floors:[]}
]};
let generated=0;
const sandbox={
  String,Array,parseInt,
  uid(){generated++;return 'conference-floor-'+generated;},
  appData:{houseTemplates:[template]}
};
vm.createContext(sandbox);
vm.runInContext(
  extract(housesSource,'getHouseTemplateById','ensureSelectedHouseTemplate')+
  extract(housesSource,'updateConferenceHousesFromTemplate','reconcileConferenceFloors'),
  sandbox
);

assert.strictEqual(
  sandbox.syncConferenceFloorFromTemplate(conference,template,floorId),2
);
const created=conference.houses[0].floors[0];
assert.strictEqual(created.id,'conference-floor-1');
assert.notStrictEqual(created.id,floorId);
assert.strictEqual(created.sourceTemplateFloorId,floorId);
assert.strictEqual(created.name,'Fifth');
assert.deepStrictEqual(Array.from(created.rooms),[]);
assert.strictEqual(conference.houses[1].floors.length,1);
assert.strictEqual(conference.houses[1].floors[0].name,'Fifth');
assert.strictEqual(conference.houses[1].floors[0].rooms.length,1);
assert.strictEqual(conference.houses[2].floors.length,0);

assert.strictEqual(
  sandbox.syncConferenceFloorFromTemplate(conference,template,floorId),2
);
assert.strictEqual(conference.houses[0].floors.length,1);
assert.strictEqual(conference.houses[1].floors.length,1);
assert.strictEqual(generated,1,'refresh must not duplicate conference floors');

const available=sandbox.getAvailableTemplateRoomsForConferenceHouse(
  conference.houses[0]
);
assert.strictEqual(available.length,1);
assert.strictEqual(available[0].number,'502');
assert.strictEqual(available[0].conferenceFloorId,created.id);

const helperBody=extract(
  scriptSource,'refreshConferenceHouseAfterTemplateMutation','saveTemplateFloor'
);
const saveBody=extract(scriptSource,'saveTemplateFloor','renderTemplateRoomModal');
assert.match(helperBody,/syncConferenceFloorFromTemplate/);
assert.match(saveBody,/refreshConferenceHouseAfterTemplateMutation\(house/);
assert.match(saveBody,/templateFloorId:floor\.id/);

console.log('template floor conference house sync tests: passed');
