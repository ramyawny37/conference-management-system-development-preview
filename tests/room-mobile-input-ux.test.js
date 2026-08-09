'use strict';

const assert=require('assert');
const fs=require('fs');
const path=require('path');
const root=path.resolve(__dirname,'..');
const script=fs.readFileSync(path.join(root,'script.js'),'utf8');
const style=fs.readFileSync(path.join(root,'style.css'),'utf8');
const index=fs.readFileSync(path.join(root,'index.html'),'utf8');

assert(script.includes('function openGuestPersonPicker(rowId,event,reason)'));
assert(script.includes('if(!postSelection && (!event || event.isTrusted !== true)) return'));
assert(script.includes('onclick="openGuestPersonPicker'));
assert(script.includes('onkeydown="openGuestPersonPickerFromKeyboard'));
assert(!script.includes('onfocus="openGuestPersonPicker'),
  'programmatic post-selection focus must not open the picker');
assert(script.includes("['Enter','ArrowDown'].indexOf(event.key) < 0"),
  'keyboard opening must require an explicit selection key');
assert(script.includes("reason === 'POST_SELECTION_NEXT_ROW'"));
assert(script.includes("bindGuestPersonRow(rowId,{reason:'POST_SELECTION_NEXT_ROW'})"));
assert(script.includes("openGuestPersonPicker(nextRow.id, null, 'POST_SELECTION_NEXT_ROW')"));
assert(script.includes("openGuestPersonPicker(\\'" )&&script.includes("\\',event)"));
assert(!script.slice(script.indexOf('function renderRoomEditorFromDraft()'),
  script.indexOf('function openRoomEditor(')).includes('.focus()'),
  'opening/rendering a room must not focus the person picker automatically');
assert(script.includes('var assignedInEditor = getAssignedPeopleInEditor()'));
assert(script.includes("if(idInput.value) delete assigned[idInput.value]"));
assert(script.includes("return person && person.id && !assigned[person.id]"));
assert(script.includes("openSearchableSelectDialog('اختيار شخص', items"));
assert(script.includes("secondaryText: person.phone || ''"));
assert(script.includes("{variant:'person-picker'}"));
assert(script.includes("oninput=\"bindGuestPersonRow"),
  'typing must preserve the existing person binding/filter path');
assert(!script.slice(script.indexOf('function openGuestPersonPicker(rowId)'),
  script.indexOf('function accommodationArrivalDayOptions(')).match(/\bsave\s*\(|queue|local_save/),
  'opening or selecting from the picker must not save or queue a conference');

assert(style.includes('@media(max-width:600px)'));
assert(style.includes('input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"])'));
assert(style.includes('select,textarea{font-size:16px!important}'));
assert(style.includes('font-size:16px!important'));
assert(style.includes('#searchableSelectModal.person-picker-modal'));
assert(style.includes('.person-picker-row{display:flex!important;min-height:54px'));
assert(style.includes('overflow-y:auto;-webkit-overflow-scrolling:touch'));
assert(index.includes('width=device-width,initial-scale=1.0'));
assert(!/user-scalable\s*=\s*no/i.test(index));
assert(!/maximum-scale\s*=\s*1/i.test(index));

console.log('room mobile input UX tests passed');
