const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
test('PNG capture uses visible canonical card for every theme',()=>{
 const src=fs.readFileSync(path.join(__dirname,'..','script.js'),'utf8');
 const start=src.indexOf('function getCardPngFile(key)');
 const end=src.indexOf('function downloadCardPngFile(',start);
 assert.ok(start>=0&&end>start);
 const route=src.slice(start,end);
 assert.match(route,/var element=findVisibleCardElementByKey\(key\)/);
 assert.match(route,/var capturePromise=captureCardElementAsPng\(element\)/);
 assert.doesNotMatch(route,/captureModernBannerCardAsPng\(card\)/);
});
