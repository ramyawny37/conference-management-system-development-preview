const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'..','script.js'),'utf8');
test('card print preview remains intact until afterprint',()=>{
 const start=source.indexOf('var conferenceCardPrintCleanup=null;');
 const end=source.indexOf('// TAB 5: SETTINGS',start);
 assert.ok(start>0&&end>start);
 const section=source.slice(start,end);
 assert.match(section,/addEventListener\('afterprint',restoreConferenceCardPrint\)/);
 assert.doesNotMatch(section,/setTimeout\(/);
 assert.match(section,/getSelectedCardKeys\(\)/);
 assert.match(section,/document\.querySelectorAll\('#cardsGrid \.guest-card'\)/);
 assert.match(section,/item\.el\.style\.display=item\.display/);
});
