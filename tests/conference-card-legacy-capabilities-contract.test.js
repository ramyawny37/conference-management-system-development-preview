'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const script=fs.readFileSync('script.js','utf8');
const css=fs.readFileSync('style.css','utf8');
const engine=fs.readFileSync('cards.js','utf8');

test('canonical cards retain person and room projections and stable participation identity',()=>{
 assert.match(engine,/function getPersonCards\(day\)/);
 assert.match(engine,/function getRoomCards\(day\)/);
 assert.match(engine,/participation:/);
 assert.match(engine,/getConferenceRoomPeopleOnDay\(room,day,context.conference\)/);
});
test('card features remain available before old UI retirement',()=>{
 for(const fn of ['renderPersonConferenceCard','renderModernBannerCard','renderModernBannerRoomCard','printOne','printSel','shareCard','shareSelectedCards','downloadCardPng','downloadSelectedCards','openSelectedCardsOnePhone','setCardMode','toggleCardsSelectionMode'])assert.match(script,new RegExp('function '+fn+'\\('),fn);
 for(const label of ['PNG','تحديد متعدد','لكل فرد','لكل غرفة'])assert.ok(script.includes(label),label);
});
test('card print dimensions and grid layout are preserved',()=>{
 assert.match(css,/@media print/);
 assert.match(css,/width:90mm!important/);
 assert.match(css,/grid-template-columns:repeat\(4,minmax\(0,1fr\)\)!important/);
 assert.match(css,/\.print-page-break/);
 assert.match(css,/print-color-adjust:exact/);
});
