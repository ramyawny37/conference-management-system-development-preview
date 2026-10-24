'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const test=require('node:test');

const read=file=>fs.readFileSync(file,'utf8');
const index=read('index.html');
const worker=read('service-worker.js');
const tokens=read('shared-design-tokens.css');
const style=read('style.css');
const shell=read('canonical-platform-shell.css');
const script=read('script.js');
const guide=read('docs/platform-design-system.md');

test('design layers have one documented runtime owner and deterministic cache graph',()=>{
  const assets=[
    'shared-design-tokens.css?rev=platform-design-system-consolidation-v2',
    'style.css?rev=conference-room-modal-readonly-scroll-v3',
    'canonical-platform-shell.css?rev=platform-administration-canonical-sidebar-navigation-v2'
  ];
  for(const asset of assets){
    assert.equal(index.split(asset).length-1,1,asset+' must load once');
    assert.equal(worker.split('./'+asset).length-1,1,asset+' must be precached once');
  }
  assert.ok(index.indexOf(assets[0])<index.indexOf(assets[1]));
  assert.ok(index.indexOf(assets[1])<index.indexOf(assets[2]));
  assert.match(guide,/Foundations[\s\S]*Shared components[\s\S]*Platform shell[\s\S]*Page patterns[\s\S]*Module-specific UI/i);
  assert.equal((shell.match(/^\.canonical-platform-shell\{/gm)||[]).length,1);
});

test('foundations centrally own shared controls and semantic states',()=>{
  for(const contract of [/\.card\{/,/\.btn\{/,/input,select,textarea\{/,/\.ui-state\{/,/\.btn:focus-visible/,/\.btn:disabled/])assert.match(tokens,contract);
  assert.doesNotMatch(style,/^\.card\{/m);
  assert.doesNotMatch(style,/^\.btn\{/m);
  assert.doesNotMatch(style,/^input,select,textarea\{/m);
  assert.match(tokens,/@media\(max-width:600px\)/);
  assert.match(tokens,/direction:rtl/);
});

test('Conference cards expose hierarchy, busy state and keyboard activation',()=>{
  const start=script.indexOf('function renderStartupConferenceCards(');
  const end=script.indexOf('\nvar startupDiscoveredOpenBusy',start);
  const renderer=script.slice(start,end);
  assert.match(renderer,/aria-busy="true"/);
  assert.match(renderer,/role="button" tabindex="0"/);
  assert.match(renderer,/event\.key===\\'Enter\\'/);
  assert.match(style,/\.conference-workspace-heading\{/);
  assert.match(style,/\.startup-conference-card:focus-visible/);
  assert.match(style,/@media\(max-width:600px\)[\s\S]*startup-conference/);
});

test('canonical accommodation composes shared states with scoped responsive patterns',()=>{
  const start=script.indexOf('function renderCanonicalAccommodation(');
  const end=script.indexOf('\nfunction deactivateAccommodationRoom',start);
  const renderer=script.slice(start,end);
  for(const marker of ['accommodation-toolbar','accommodation-canonical-summary','accommodation-room-toolbar','accommodation-guest-meta','ui-state--loading','ui-state--error','ui-state--denied'])assert.match(renderer,new RegExp(marker));
  assert.doesNotMatch(renderer,/style="/);
  assert.match(renderer,/getConferenceOperationalDay\(getCurrentConference\(\)\)/);
  assert.match(renderer,/getCanonicalAccommodationOccupanciesOnDay\(room,operationalDay\)/);
  assert.match(renderer,/room\.isClosed\?'disabled title="الغرفة مغلقة"'/);
  assert.match(style,/#tab0 \.accommodation-toolbar\{/);
  assert.match(style,/#tab0 \.room-card\.room-closed\{/);
  for(const breakpoint of ['900','600','420'])assert.match(style,new RegExp('@media\\(max-width:'+breakpoint+'px\\)'));
});

test('Reservations and Warehouse keep module-specific layout ownership',()=>{
  assert.match(index,/modules\/reservations\/reservations-module\.css\?rev=/);
  assert.match(style,/\.warehouse-app\{/);
  assert.match(guide,/Reservations layout[\s\S]*Reservations module stylesheet/);
  assert.match(guide,/Warehouse layout[\s\S]*Warehouse-scoped section/);
});
