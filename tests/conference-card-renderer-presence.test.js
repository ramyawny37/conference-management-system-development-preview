const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
test('canonical card renderers survive legacy PNG removal',()=>{
 const s=fs.readFileSync(path.join(__dirname,'..','script.js'),'utf8');
 for(const fn of ['renderCards','renderPersonConferenceCard','renderModernBannerCard','captureCardElementAsPng','findVisibleCardElementByKey'])assert.match(s,new RegExp('function '+fn+'\\('));
 assert.doesNotMatch(s,/function renderModernBannerExport\(/);
 assert.doesNotMatch(s,/function captureModernBannerCardAsPng\(/);
});
