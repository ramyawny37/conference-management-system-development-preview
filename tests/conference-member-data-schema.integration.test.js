'use strict';
var assert=require('assert'),fs=require('fs'),path=require('path'),vm=require('vm');
var root=path.resolve(__dirname,'..');
var peopleSource=fs.readFileSync(path.join(root,'people.js'),'utf8');
var scriptSource=fs.readFileSync(path.join(root,'script.js'),'utf8');
function extract(source,name,nextName){
  var start=source.indexOf('function '+name+'('),end=source.indexOf('\nfunction '+nextName+'(',start);
  assert.ok(start>=0&&end>start,name+' source missing');return source.slice(start,end);
}
var owner={
  id:'conference-a',name:'Full Conference',status:'active',
  accommodationDisplayedRoomIds:['room-active'],
  accommodationDisplayStateInitialized:true,
  houses:[{id:'house-a',name:'House A',floors:[{id:'floor-a',name:'Floor A',rooms:[
    {id:'room-active',number:'101',beds:2,closed:false,
      guests:[{id:'person-adult'}],children:[{personId:'person-child',guardianPersonId:'person-adult'}]},
    {id:'room-removed',number:'102',beds:1,closed:false,guests:[],children:[]}
  ]}]}],
  peopleDb:{version:'1.0.0',people:[
    {id:'person-adult',fullName:'Adult Member'},
    {id:'person-child',fullName:'Child Member'}
  ]},
  transports:[{id:'transport-a',name:'Bus A',icon:'bus',capacity:2,seats:[
    {seat:1,personId:'person-adult',name:'',room:'101',type:'adult',riders:[
      {r:{personId:'person-child',name:'',type:'child_shared'}}
    ]},{seat:2,name:'',room:'',type:'adult'}
  ]}],
  restaurant:{meals:{breakfast:{enabled:true,price:10,childPrice:5}}},
  restaurantV3:{enabled:true,plan:{firstMeal:'breakfast'}},
  accommodationV3:{enabled:true,pricing:{mode:'per_room_night'}},
  airConditioningV3:{enabled:true,pricing:{mode:'per_room_day'}},
  accounts:{settings:{currency:'EGP'},expenses:{accommodation:{enabled:true}}},
  financialV3:{enabled:true,adjustments:[{id:'adjustment-a',amount:25}]},
  activityLog:[{id:'log-a',action:'created'}]
};
var sandbox={window:null};sandbox.window=sandbox;
vm.runInNewContext(extract(peopleSource,'normalizeConferencePeopleReferences','linkRoomPeopleToDatabase'),sandbox);
sandbox.normalizeConferencePeopleReferences(owner);
var member=JSON.parse(JSON.stringify(owner));
sandbox.normalizeConferencePeopleReferences(member);
assert.strictEqual(member.houses[0].floors[0].rooms[0].guests[0].name,'Adult Member');
assert.strictEqual(member.houses[0].floors[0].rooms[0].children[0].name,'Child Member');
assert.strictEqual(member.houses[0].floors[0].rooms[0].children[0].guardian,'Adult Member');
assert.strictEqual(member.transports[0].seats[0].name,'Adult Member');
assert.strictEqual(member.transports[0].seats[0].riders[0].r.name,'Child Member');
['houses','transports','restaurant','restaurantV3','accommodationV3','airConditioningV3',
  'accounts','financialV3','activityLog'].forEach(function(field){
  assert.deepStrictEqual(JSON.parse(JSON.stringify(member[field])),
    JSON.parse(JSON.stringify(owner[field])),field+' schema changed during member normalization');
});
assert.deepStrictEqual(member.accommodationDisplayedRoomIds,['room-active']);

var tab={innerHTML:''};
Object.assign(sandbox,{
  currentConferenceRuntimeAccessRole:'viewer',getCurrentConference:function(){return member;},
  ge:function(id){return id==='tab1'?tab:null;},esc:function(value){return String(value||'');},
  unassigned:function(currentName){assert.strictEqual(currentName,'');return [];},
  accommodationIcon:function(){return '';},
  getTransportRiderData:function(rider){return rider&&rider.r?rider.r:rider||{};},
  formatTransportSeatLabel:function(value){return String(value||'');}
});
vm.runInNewContext(
  extract(scriptSource,'canEditCurrentConferenceData','canEditCurrentConferenceAccommodation')+'\n'+
  extract(scriptSource,'renderTransports','openTM'),sandbox
);
sandbox.renderTransports();
assert.ok(tab.innerHTML.includes('Bus A'));
assert.ok(tab.innerHTML.includes('Adult Member'));
assert.ok(tab.innerHTML.includes('Child Member'));
assert.ok(!tab.innerHTML.includes('openTM('),'viewer transport output contains edit controls');
assert.ok(!tab.innerHTML.includes('openSM('),'viewer transport output contains seat edit controls');
console.log('conference member data schema integration tests: passed');
