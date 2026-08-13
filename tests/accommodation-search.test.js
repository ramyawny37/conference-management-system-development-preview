'use strict';

const assert=require('assert');
const fs=require('fs');
const path=require('path');
const vm=require('vm');

const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'script.js'),'utf8');
const stateSource=fs.readFileSync(path.join(root,'state.js'),'utf8');
const styleSource=fs.readFileSync(path.join(root,'style.css'),'utf8');
const indexSource=fs.readFileSync(path.join(root,'index.html'),'utf8');

function between(start,end){
  const from=source.indexOf(start);
  const to=source.indexOf(end,from);
  assert.ok(from>=0&&to>from,'failed to extract '+start);
  return source.slice(from,to);
}

const helperSource=between('function normalizeAccommodationSearchText(',
  'function updateAccommodationSearch(');
const context={
  getAccommodationPersonDisplayName(person){
    return person.personId==='person-1'?'Mina Adel':(person.name||'');
  }
};
vm.createContext(context);
vm.runInContext(helperSource,context);

const normalize=context.normalizeAccommodationSearchText;
const matches=context.accommodationRoomMatchesSearch;
const rooms=[
  {id:'room-502',number:502,house:{id:'house-a'},floor:{id:'floor-a'},guests:[{personId:'person-1'}],children:[{name:'طفل مميز'}]},
  {id:'room-503',number:'503',house:{id:'house-a'},floor:{id:'floor-b'},guests:[{name:'John   Smith'}],children:[]},
  {id:'room-210',number:'210',house:{id:'house-b'},floor:{id:'floor-c'},guests:[],children:[]}
];
function filtered(query){
  const normalized=normalize(query);
  return rooms.filter(room=>matches(room,normalized));
}

assert.deepStrictEqual(filtered('').map(room=>room.id),rooms.map(room=>room.id),
  'empty query must preserve the accommodation room set');
assert.deepStrictEqual(filtered('mina').map(room=>room.id),['room-502'],'adult personId name must match');
assert.deepStrictEqual(filtered('طفل مميز').map(room=>room.id),['room-502'],'child name must match');
assert.deepStrictEqual(filtered('502').map(room=>room.id),['room-502'],'numeric room number must match');
assert.deepStrictEqual(filtered('50').map(room=>room.id),['room-502','room-503'],'room number match must be partial');
assert.strictEqual(normalize('٥٠٢'),'502','Arabic digits must normalize');
assert.strictEqual(normalize('۵۰۲'),'502','Persian digits must normalize');
assert.deepStrictEqual(filtered('MINA').map(room=>room.id),['room-502'],'name matching must ignore case');
assert.deepStrictEqual(filtered('  john smith  ').map(room=>room.id),['room-503'],'whitespace must normalize');
assert.strictEqual(filtered('502 mina').length,0,'the query is matched as one normalized value');
assert.strictEqual(new Set(filtered('50').map(room=>room.id)).size,filtered('50').length,
  'a matching room must be rendered once');
assert.deepStrictEqual(filtered('210').map(room=>room.id),['room-210'],'nonmatching rooms must be hidden');

const accommodationBlock=between('function normalizeAccommodationSearchText(',
  'var editRoomData = {}');
assert.match(accommodationBlock,/visibleRooms\.forEach\(function\(roomEntry\)/,
  'filtering must happen before house/floor grouping');
assert.match(accommodationBlock,/if\(!isFiltering\)[\s\S]*current\.houses/,
  'empty houses/floors must not be pre-created while filtering');
assert.match(accommodationBlock,/floorEntry\.rooms\.forEach\(function\(r\)/,
  'the existing room-card rendering loop must be reused');
assert.match(accommodationBlock,/class="rcard"/,'full room card must remain present');
assert.match(accommodationBlock,/openRoomEditor\(/,'room actions must remain present');
assert.match(accommodationBlock,/canEditAccommodation/,'viewing users must still reach filtering before action gating');
assert.match(accommodationBlock,/accommodationSearchQuery/,'query must survive ordinary rerenders');
assert.match(accommodationBlock,/function clearAccommodationSearch\(\)[\s\S]*accommodationSearchQuery=''/,
  'clear must restore the unfiltered room set');
assert.doesNotMatch(helperSource,/requireAccommodationMutation|beginAccommodationEditing/,
  'search matching must not acquire the accommodation lock');
assert.doesNotMatch(accommodationBlock,/\bsave\s*\(|IndexedDB|\.rpc\s*\(|SyncQueue|syncQueue|Realtime.*(?:set|write|push)/,
  'search must not save, write IndexedDB, queue, RPC, or mutate realtime state');
assert.match(stateSource,/var accommodationSearchQuery='';/,
  'query must be transient UI state');
assert.doesNotMatch(stateSource,/localStorage[^\n]*accommodationSearchQuery|accommodationSearchQuery[^\n]*localStorage/,
  'query must not use localStorage');
assert.match(styleSource,/@media\(max-width:600px\)\{\.accommodation-search-controls/,
  'search controls must include a mobile layout');

assert.match(indexSource,/onclick="switchTab\(5\)"[\s\S]*>بحث</,
  'the existing Search tab must remain');
assert.match(source,/function renderSearch\(\)/,'existing Search tab renderer must remain');
assert.match(source,/function liveSearch\(q\)/,'existing Search tab search must remain');
assert.match(source,/function liveSearch\(q\)[\s\S]*transports\.forEach/,
  'existing transport search must remain');
assert.match(source,/function liveSearch\(q\)[\s\S]*openSM\(/,
  'existing transport result action must remain');

console.log('accommodation search tests: passed');
