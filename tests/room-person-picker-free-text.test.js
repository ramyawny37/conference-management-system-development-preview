'use strict';

const assert=require('assert');
const fs=require('fs');
const vm=require('vm');

const source=fs.readFileSync('script.js','utf8');
function extract(start,end){
  const from=source.indexOf('function '+start+'(');
  const to=source.indexOf('function '+end+'(',from);
  assert(from>=0&&to>from,start+' extraction failed');
  return source.slice(from,to);
}
function element(){
  return {
    children:[],className:'',textContent:'',type:'',onclick:null,
    appendChild(child){this.children.push(child);return child;},
    setAttribute(){},
    set innerHTML(value){this._innerHTML=value;this.children=[];},
    get innerHTML(){return this._innerHTML||'';}
  };
}

const list=element();
const search={value:'Ramy'};
const nameInput={value:''};
const idInput={value:'stale-person'};
const row={id:'guest-row',querySelector(selector){
  return selector==='.person-name'?nameInput:idInput;
}};
const people=[];
let boundRow='';
const sandbox={
  String,
  guestPersonPickerState:{rowId:'guest-row',items:[],onSelect:null},
  ge(id){return id==='guestPersonPickerList'?list:
    id==='guestPersonPickerSearch'?search:id==='guest-row'?row:null;},
  normalizePersonKey(value){return String(value||'').trim().toLowerCase();},
  findPersonByName(value){
    const key=String(value||'').trim().toLowerCase();
    return people.find(person=>person.fullName.toLowerCase()===key)||null;
  },
  document:{createElement:element},
  closeGuestPersonPicker(){
    sandbox.guestPersonPickerState={rowId:'',items:[],onSelect:null};
  },
  bindGuestPersonRow(rowId){boundRow=rowId;}
};
vm.createContext(sandbox);
vm.runInContext(extract('renderGuestPersonPickerList','positionGuestPersonPicker'),sandbox);

sandbox.renderGuestPersonPickerList();
assert.strictEqual(list.children.length,1);
assert.strictEqual(list.children[0].textContent,'استخدام "Ramy" كاسم جديد');
assert.strictEqual(list.innerHTML.includes('لا توجد نتائج'),false,
  'a valid free-text query must not be a dead end');
list.children[0].onclick();
assert.strictEqual(nameInput.value,'Ramy');
assert.strictEqual(idInput.value,'');
assert.strictEqual(boundRow,'guest-row');

const existing={id:'person-1',fullName:'Ramy',phone:''};
people.push(existing);
search.value='Ramy';
nameInput.value='';idInput.value='';boundRow='';
sandbox.guestPersonPickerState={
  rowId:'guest-row',
  items:[{label:'Ramy',searchText:'Ramy',data:existing}],
  onSelect(person){nameInput.value=person.fullName;idInput.value=person.id;}
};
sandbox.renderGuestPersonPickerList();
assert.strictEqual(list.children.length,1,
  'an exact existing person must not get a duplicate new-name option');
list.children[0].onclick();
assert.strictEqual(nameInput.value,'Ramy');
assert.strictEqual(idInput.value,'person-1');

console.log('room person picker free-text tests passed');
