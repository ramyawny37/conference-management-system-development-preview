'use strict';

const assert=require('assert');
const fs=require('fs');
const path=require('path');
const root=path.resolve(__dirname,'..');
const script=fs.readFileSync(path.join(root,'script.js'),'utf8');
const style=fs.readFileSync(path.join(root,'style.css'),'utf8');
const index=fs.readFileSync(path.join(root,'index.html'),'utf8');

assert(script.includes('function openGuestPersonPicker(rowId)'));
assert(script.includes('onfocus="openGuestPersonPicker'));
assert(script.includes('onclick="openGuestPersonPicker'));
assert(script.includes('var assignedInEditor = getAssignedPeopleInEditor()'));
assert(script.includes("if(idInput.value) delete assigned[idInput.value]"));
assert(script.includes("return person && person.id && !assigned[person.id]"));
assert(script.includes("openSearchableSelectDialog('اختيار شخص', items"));
assert(script.includes("oninput=\"bindGuestPersonRow"),
  'typing must preserve the existing person binding/filter path');
assert(!script.slice(script.indexOf('function openGuestPersonPicker(rowId)'),
  script.indexOf('function accommodationArrivalDayOptions(')).match(/\bsave\s*\(|queue|local_save/),
  'opening or selecting from the picker must not save or queue a conference');

assert(style.includes('@media(max-width:600px)'));
assert(style.includes('#roomModal input:not([type="checkbox"])'));
assert(style.includes('#roomModal select'));
assert(style.includes('#roomModal textarea'));
assert(style.includes('font-size:16px!important'));
assert(index.includes('width=device-width,initial-scale=1.0'));
assert(!/user-scalable\s*=\s*no/i.test(index));
assert(!/maximum-scale\s*=\s*1/i.test(index));

console.log('room mobile input UX tests passed');
