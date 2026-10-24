const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
test('print preview isolates canonical card clones from platform chrome',()=>{
 const js=fs.readFileSync(path.join(__dirname,'..','script.js'),'utf8');
 const css=fs.readFileSync(path.join(__dirname,'..','style.css'),'utf8');
 assert.match(js,/printRoot\.id='conferenceCardPrintRoot'/);
 assert.match(js,/var copy=el\.cloneNode\(true\)/);
 assert.match(js,/document\.body\.appendChild\(printRoot\)/);
 assert.match(js,/printRoot\.parentNode\.removeChild\(printRoot\)/);
 assert.match(css,/body:has\(> #conferenceCardPrintRoot\)>:not\(#conferenceCardPrintRoot\)/);
 assert.match(css,/\.conference-card-print-single>\.guest-card\{width:90mm!important/);
});
