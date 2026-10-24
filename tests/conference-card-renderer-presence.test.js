const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
test('canonical card renderers survive legacy PNG removal',()=>{
 const s=fs.readFileSync(path.join(__dirname,'..','script.js'),'utf8');
 for(const fn of ['renderCards','renderPersonConferenceCard','renderModernBannerCard','captureCardElementAsPng','findVisibleCardElementByKey'])assert.match(s,new RegExp('function '+fn+'\\('));
 assert.doesNotMatch(s,/function renderModernBannerExport\(/);
 assert.doesNotMatch(s,/function captureModernBannerCardAsPng\(/);
});

test('room cards reuse personal templates and retain every active room occupant',()=>{
 const s=fs.readFileSync(path.join(__dirname,'..','script.js'),'utf8');
 const start=s.indexOf('function renderCards(){');
 const end=s.indexOf('function setCardMode(',start);
 const renderer=s.slice(start,end);
 assert.match(renderer,/h\+=renderPersonConferenceCard\(it\)/);
 assert.doesNotMatch(renderer,/renderModernBannerRoomCard|class="gc-head"|class="gc-body"/);
 assert.match(renderer,/members:members/);
 const modern=s.slice(s.indexOf('function renderModernBannerCard('),s.indexOf('function renderPersonConferenceCard('));
 const classic=s.slice(s.indexOf('function renderPersonConferenceCard('),start);
 for(const template of [modern,classic]){
  assert.match(template,/card\.members\.map\(function\(member\)/);
  assert.match(template,/conferenceRoomMemberText\(member\)/);
  assert.match(template,/welcome-card-room-guests/);
 }
 const css=fs.readFileSync(path.join(__dirname,'..','style.css'),'utf8');
 assert.match(css,/\.welcome-card-room-guests\{/);
 assert.match(css,/#conferenceCardPrintRoot>\.guest-card\{width:90mm!important/);
});
