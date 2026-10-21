const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');

const root=path.join(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const html=read('index.html');
const shell=read('canonical-platform-shell.css');
const integration=read('js/platform-integration.js');
const worker=read('service-worker.js');

test('runtime owns one canonical header, sidebar and workspace host',()=>{
  assert.equal((html.match(/data-canonical-platform-header(?=[\s>])/g)||[]).length,1);
  assert.equal((html.match(/data-canonical-platform-sidebar(?=[\s>])/g)||[]).length,1);
  assert.equal((html.match(/data-canonical-platform-workspace-host(?=[\s>])/g)||[]).length,1);
  assert.doesNotMatch(html,/class="main-tabs"|class="[^"]*\bmain-tab\b/);
  assert.match(html,/class="conference-context-toolbar" id="applicationTopbar"/);
});

test('conference sections use the canonical expandable sidebar and Conference route owner',()=>{
  assert.match(html,/data-platform-nav-group="conference"[\s\S]*id="conferencePlatformSubnav"/);
  for(let tab=0;tab<=6;tab++)assert.match(html,new RegExp(`data-conference-tab="${tab}"`));
  assert.match(integration,/conferenceTab[\s\S]*resolveConferenceTabRoute[\s\S]*platformServices\(\)\.navigate\(targetRoute\)/);
  assert.match(integration,/conference-section-change/);
});

test('reservations prototype is absent from runtime, cache and module ownership',()=>{
  for(const source of [html,worker,integration,shell])assert.doesNotMatch(source,/reservations-prototype|reservations-visual-prototype/);
  assert.equal(fs.existsSync(path.join(root,'modules/reservations/reservations-visual-prototype.js')),false);
  assert.equal(fs.existsSync(path.join(root,'modules/reservations/reservations-visual-prototype.css')),false);
});

test('responsive shell retains one right sidebar and mobile drawer',()=>{
  assert.match(shell,/\.canonical-platform-sidebar\{[^}]*inset:12px 12px 12px auto/);
  assert.match(shell,/@media\(max-width:900px\)[\s\S]*platform-navigation-open \.canonical-platform-sidebar\{transform:translateX\(0\)\}/);
  assert.match(worker,/development-conference-navigation-consolidation-v1/);
});
