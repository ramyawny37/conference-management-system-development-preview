'use strict';

const assert=require('node:assert');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');

const root=path.join(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const css=fs.readFileSync(path.join(root,'canonical-platform-shell.css'),'utf8');
const tokens=fs.readFileSync(path.join(root,'shared-design-tokens.css'),'utf8');
const reservations=fs.readFileSync(path.join(root,'modules/reservations/reservations-module.js'),'utf8');
const reservationsCss=fs.readFileSync(path.join(root,'modules/reservations/reservations-module.css'),'utf8');
const warehouse=fs.readFileSync(path.join(root,'js/warehouse/workspace.js'),'utf8');
const worker=fs.readFileSync(path.join(root,'service-worker.js'),'utf8');

test('the document exposes exactly one canonical shell, sidebar, header, and workspace host',()=>{
  assert.strictEqual((html.match(/data-canonical-platform-shell(?=[\s>])/g)||[]).length,1);
  assert.strictEqual((html.match(/data-canonical-platform-sidebar(?=[\s>])/g)||[]).length,1);
  assert.strictEqual((html.match(/data-canonical-platform-header(?=[\s>])/g)||[]).length,1);
  assert.strictEqual((html.match(/data-canonical-platform-workspace-host(?=[\s>])/g)||[]).length,1);
  assert.match(html,/class="canonical-platform-nav"/);
  assert.match(html,/class="canonical-platform-nav__item" data-platform-home/);
  assert.strictEqual((html.match(/data-platform-module="conference"/g)||[]).length,1);
  assert.strictEqual((html.match(/data-platform-module="reservations"/g)||[]).length,1);
  assert.strictEqual((html.match(/data-platform-module="warehouse"/g)||[]).length,1);
  assert.match(html,/class="conference-context-toolbar" id="applicationTopbar"/);
  assert.doesNotMatch(html,/class="main-tabs"|class="[^"]*\bmain-tab\b/);
  assert.match(html,/id="conferenceWorkspace"/);
  assert.match(html,/id="warehouseWorkspace"/);
  assert.match(html,/id="reservationsWorkspace"/);
});

test('the canonical shell is the only active global shell stylesheet',()=>{
  const canonicalAsset='canonical-platform-shell.css?rev=platform-administration-canonical-sidebar-navigation-v2';
  assert.match(html,new RegExp(canonicalAsset.replace(/[.?]/g,'\\$&')));
  assert.match(worker,new RegExp(canonicalAsset.replace(/[.?]/g,'\\$&')));
  assert.match(html,/js\/platform-integration\.js\?rev=canonical-accommodation-room-details-v4/);
  assert.match(worker,/js\/platform-integration\.js\?rev=canonical-accommodation-room-details-v4/);
  assert.doesNotMatch(html,/platform-shell-v2\.css|class="platform-shell-v2"/);
  assert.doesNotMatch(worker,/platform-shell-v2\.css/);
  assert.strictEqual(fs.existsSync(path.join(root,'platform-shell-v2.css')),false);
  assert.ok(html.indexOf('modules/reservations/reservations-module.css')<html.indexOf(canonicalAsset));
  assert.doesNotMatch(css,/!important/);
  assert.doesNotMatch(css,/(^|\n)\.reference-|#reservationsWorkspace|#warehouseWorkspace/);
  assert.doesNotMatch(css,/\[data-active-platform-module="reservations"\]\{--canonical-sidebar-width:/);
  assert.match(css,/\.canonical-platform-header\{[^}]*right:calc\(var\(--canonical-sidebar-width\) \+ 24px\)/);
  assert.match(css,/\.canonical-platform-workspace-host,#applicationBody,#applicationTopbar\{margin-inline-start:calc\(var\(--canonical-sidebar-width\) \+ 24px\);margin-inline-end:var\(--canonical-shell-gutter\)\}/);
  assert.doesNotMatch(css,/\[data-reservations-module-root\] \.reference-(?:hero|stats|actions|insights|lower-grid)/);
});

test('shared tokens remain the global source and the shell owns only local layout variables',()=>{
  assert.doesNotMatch(css,/:root\s*\{/);
  assert.match(css,/\.canonical-platform-shell\{--canonical-sidebar-width:204px;--canonical-shell-gutter:24px;--canonical-header-height:64px/);
  assert.match(css,/var\(--platform-v2-navy\)/);
  assert.match(css,/var\(--platform-v2-border\)/);
  assert.match(tokens,/--platform-touch-target:44px/);
  assert.match(tokens,/--platform-safe-area-bottom:max\(16px,env\(safe-area-inset-bottom,0px\)\)/);
  assert.doesNotMatch(tokens,/--platform-v2-primary:/);
  assert.match(tokens,/--platform-v2-navy:var\(--platform-primary-dark\)/);
  assert.match(tokens,/--platform-v2-border:var\(--platform-border\)/);
});

test('the shell has intentional desktop and mobile layout contracts',()=>{
  assert.match(css,/\.canonical-platform-sidebar\{[^}]*position:fixed[^}]*width:var\(--canonical-sidebar-width\)/);
  assert.match(css,/\.canonical-platform-header\{[^}]*right:calc\(var\(--canonical-sidebar-width\) \+ 24px\)/);
  assert.match(css,/@media\(max-width:900px\)[\s\S]*\.canonical-platform-shell\.platform-navigation-open \.canonical-platform-sidebar\{transform:translateX\(0\)\}/);
  assert.match(css,/@media\(max-width:600px\)/);
  assert.match(html,/<meta name="viewport" content="width=device-width,initial-scale=1\.0,viewport-fit=cover">/);
});

test('Reservations is real module-owned markup within the shared workspace',()=>{
  assert.match(reservations,/data-reservations-module-root/);
  for(const className of ['reference-dashboard','reference-hero','reference-stats','reference-actions','reference-insights','reference-lower-grid'])assert.match(reservations,new RegExp(className));
  assert.match(reservations,/ReservationsPlatformModule/);
  assert.doesNotMatch(reservationsCss,/\.reference-dashboard\.reference-dashboard/);
  assert.doesNotMatch(reservationsCss,/min-height:124px/);
  assert.match(reservationsCss,/\.reference-dashboard\{/);
  assert.match(reservationsCss,/\.reference-hero\{min-height:122px/);
  assert.match(reservationsCss,/\.reference-stats\{height:66px;[^}]*grid-template-columns:repeat\(5/);
  assert.match(reservationsCss,/\.reference-insights>\.reference-panel\{height:166px/);
  assert.match(reservationsCss,/\.reference-ring\{[^}]*width:80px;height:80px/);
  assert.match(reservationsCss,/\.reference-lower-grid\{[^}]*grid-template-areas:"bookings tools";align-items:start/);
  assert.doesNotMatch(reservations,/سيتم ربط الصفوف ببيانات الحجوزات بعد اعتماد الشكل/);
});

test('module workspaces do not reintroduce a second brand, topbar, or account shell',()=>{
  assert.doesNotMatch(warehouse,/class="warehouse-brand"/);
  assert.doesNotMatch(warehouse,/class="warehouse-topbar"/);
  assert.doesNotMatch(warehouse,/class="warehouse-account"/);
  assert.doesNotMatch(warehouse,/data-wh-modules/);
  assert.match(warehouse,/class="warehouse-sidebar"[\s\S]*?<nav>/);
  assert.match(warehouse,/class="warehouse-menu-trigger" data-wh-menu/);
  assert.match(html,/data-startup-auth-account-name/);
  assert.match(html,/SyncSettingsUI\.signOut\(\)/);
});

test('Development installs the canonical foundation cache without changing Production revision',()=>{
  assert.match(worker,/\? 'development-canonical-accommodation-room-details-v4'/);
  assert.doesNotMatch(worker,/conference-owner-preflight-correction-v1/);
  assert.match(worker,/: 'production-3-6-0-release-v6'/);
});

test('active sidebar entries are reconciled from the canonical route and module, not stale click state',()=>{const integration=fs.readFileSync(path.join(root,'js/platform-integration.js'),'utf8');assert.match(integration,/function reflectActiveModule\(id\)/);assert.match(integration,/shell\.querySelectorAll\('\[data-platform-module\],\[data-platform-route\]'\)/);assert.match(integration,/item\.classList\.toggle\('active',selected\)/);assert.match(integration,/item\.removeAttribute\('aria-current'\)/);});
