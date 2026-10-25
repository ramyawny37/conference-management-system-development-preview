const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
test('print cards retain the same fixed physical width for individual and bulk output',()=>{
 const css=fs.readFileSync(path.join(__dirname,'..','style.css'),'utf8');
 const js=fs.readFileSync(path.join(__dirname,'..','script.js'),'utf8');
 const block=css.slice(css.indexOf('/* Print-only projection of the same canonical card DOM'));
 assert.match(block,/grid-template-columns:repeat\(2,90mm\)!important/);
 assert.match(block,/#conferenceCardPrintRoot>\.guest-card\{[^}]*width:90mm!important/);
 assert.match(block,/#conferenceCardPrintRoot>\.guest-card\{display:flex!important;flex-direction:column!important/);
 assert.match(block,/box-shadow:none!important/);
 assert.match(js,/copy\.classList\.remove\('print-page-break','welcome-card-selected'\)/);
 assert.match(js,/copy\.style\.boxShadow='none'/);
});

test('room and personal cards share 90mm screen width without hiding occupants, and PNG matches',()=>{
 const css=fs.readFileSync(path.join(__dirname,'..','style.css'),'utf8');
 const js=fs.readFileSync(path.join(__dirname,'..','script.js'),'utf8');
 assert.match(css,/#tab4 #cardsGrid>\.welcome-card\{width:90mm;min-width:90mm;max-width:90mm/);
 assert.match(css,/\.welcome-card-room-guests\{[^}]*max-height:none;overflow:visible/);
 assert.match(css,/\.welcome-card-room-guests>div\{overflow-wrap:anywhere;white-space:normal\}/);
 assert.match(js,/var exportWidth=90\*96\/25\.4;/);
 assert.match(js,/h\+=renderPersonConferenceCard\(it\)/);
});
