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
assert(script.slice(script.indexOf('function renderRoomEditorFromDraft()'),
  script.indexOf('function openRoomEditor(')).includes('closeGuestPersonPicker()'));
assert(script.slice(script.indexOf('function closeRM()'),
  script.indexOf('function getAssignedPeopleInEditor()')).includes('closeGuestPersonPicker()'));
assert(script.includes('var assignedInEditor = getAssignedPeopleInEditor()'));
assert(script.includes("if(idInput.value) delete assigned[idInput.value]"));
assert(script.includes("return person && person.id && !assigned[person.id]"));
assert(script.includes('function openGuestPersonPickerPopover(rowId,items,onSelect)'));
assert(script.includes('function positionGuestPersonPicker()'));
assert(script.includes('input.getBoundingClientRect()'));
assert(script.includes('window.visualViewport'));
assert(script.includes('availableBelow < 230 && availableAbove > availableBelow'));
assert(script.includes("openGuestPersonPickerPopover(rowId,items,function(person)"));
assert(!script.slice(script.indexOf('function openGuestPersonPicker(rowId,event,reason)'),
  script.indexOf('function openGuestPersonPickerFromKeyboard(')).includes('openSearchableSelectDialog'),
  'person picker must not use the centered searchable modal');
assert(script.includes("secondaryText: person.phone || ''"));
assert(script.includes("row.getAttribute('data-slot-label')"));
assert(script.includes("div.setAttribute('data-slot-label','سرير "));
assert(!script.includes('class="person-name" list="people_datalist"'),
  'adult person picker must not use the native datalist');
assert(script.includes("oninput=\"bindGuestPersonRow"),
  'typing must preserve the existing person binding/filter path');
assert(!script.slice(script.indexOf('function openGuestPersonPicker(rowId)'),
  script.indexOf('function accommodationArrivalDayOptions(')).match(/\bsave\s*\(|queue|local_save/),
  'opening or selecting from the picker must not save or queue a conference');

assert(style.includes('@media(max-width:600px)'));
assert(style.includes('input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"])'));
assert(style.includes('select,textarea{font-size:16px!important}'));
assert(style.includes('font-size:16px!important'));
assert(style.includes('.guest-person-picker-popover{'));
assert(style.includes('position:fixed'));
assert(style.includes('backdrop-filter:blur(16px)'));
assert(style.includes('-webkit-backdrop-filter:blur(16px)'));
assert(style.includes('.guest-person-picker-target .person-name'));
assert(style.includes('.guest-person-picker-option{display:grid;width:100%;min-height:58px'));
assert(style.includes('overflow-y:auto;-webkit-overflow-scrolling:touch'));
assert(index.includes('width=device-width,initial-scale=1.0'));
assert(!/user-scalable\s*=\s*no/i.test(index));
assert(!/maximum-scale\s*=\s*1/i.test(index));

console.log('room mobile input UX tests passed');
