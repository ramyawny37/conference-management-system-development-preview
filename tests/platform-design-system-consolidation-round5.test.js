'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const test=require('node:test');
const {JSDOM}=require('jsdom');

const read=file=>fs.readFileSync(file,'utf8');
const tokens=read('shared-design-tokens.css');
const style=read('style.css');
const shell=read('canonical-platform-shell.css');
const reservations=read('modules/reservations/reservations-module.css');
const index=read('index.html');
const worker=read('service-worker.js');
const reference=read('design-system-reference.html');

test('canonical tokens own visual decisions and compatibility values are aliases only',()=>{
  assert.doesNotMatch(style,/:root\s*\{[\s\S]{0,9000}--app-primary:/);
  for(const token of ['--platform-primary','--platform-success-soft','--platform-font-size-body','--platform-motion-fast','--app-primary','--ds-primary'])assert.match(tokens,new RegExp(token.replaceAll('-','\\-')+'\\s*:'));
  const v2Definitions=[...tokens.matchAll(/(--platform-v2-[\w-]+)\s*:\s*([^;]+)/g)];
  assert.deepEqual(v2Definitions.map(match=>match[1]),['--platform-v2-border','--platform-v2-navy','--platform-v2-text']);
  for(const match of v2Definitions)assert.match(match[2],/^var\(--platform-/);
  assert.doesNotMatch(tokens,/--platform-v2-(?:primary|success|warning|danger|purple|cyan|radius|shadow|sidebar)/);
});

test('every shared component family has one central contract',()=>{
  const contracts=['ui-icon-button','ui-field','ui-choice','ui-search','ui-toolbar','ui-kpi','ui-table','ui-pagination','ui-filter','ui-tab','ui-badge','ui-dialog','ui-feedback','ui-toast','ui-skeleton','ui-state'];
  for(const name of contracts){
    assert.match(tokens,new RegExp('\\.'+name+'(?:[-_{:.]|\\b)'));
    assert.doesNotMatch(style,new RegExp('^\\.'+name+'(?:[-_{:.]|\\b)','m'));
    assert.doesNotMatch(shell,new RegExp('^\\.'+name+'(?:[-_{:.]|\\b)','m'));
    assert.doesNotMatch(reservations,new RegExp('^\\.'+name+'(?:[-_{:.]|\\b)','m'));
  }
  assert.match(tokens,/@media\(prefers-reduced-motion:reduce\)/);
  assert.match(tokens,/@media\(max-width:600px\)[\s\S]*\.ui-toolbar/);
});

test('Development reference uses real components without app routing, data, or scripts',()=>{
  const dom=new JSDOM(reference,{url:'https://development.invalid/design-system-reference.html'});
  const document=dom.window.document;
  assert.equal(document.documentElement.dir,'rtl');
  assert.equal(document.querySelectorAll('script').length,0);
  assert.equal(document.querySelectorAll('.canonical-platform-shell').length,0);
  assert.equal(document.querySelectorAll('[data-platform-module]').length,0);
  assert.equal(document.querySelectorAll('.btn').length>=7,true);
  assert.equal(document.querySelectorAll('.ui-state').length,4);
  assert.equal(document.querySelectorAll('[role="alert"]').length>=3,true);
  const disabled=document.querySelector('button:disabled');
  let clicks=0;disabled.addEventListener('click',()=>{clicks++});disabled.click();
  assert.equal(clicks,0,'native disabled behavior must remain intact');
  const primary=document.querySelector('.btn-blue');primary.focus();
  assert.equal(document.activeElement,primary,'shared action must remain keyboard focusable');
  assert.doesNotMatch(reference,/style="|onclick=|fetch\(|supabase|PlatformDeviceSession/);
  assert.match(worker,/\.\/design-system-reference\.html/);
  assert.doesNotMatch(index,/design-system-reference\.html/);
});

test('runtime CSS load order and cache revisions remain atomic',()=>{
  const shared='shared-design-tokens.css?rev=platform-design-system-consolidation-v2';
  const pages='style.css?rev=canonical-accommodation-room-details-v4';
  const canonical='canonical-platform-shell.css?rev=conference-header-content-offset-v1';
  assert.ok(index.indexOf(shared)<index.indexOf(pages));
  assert.ok(index.indexOf(pages)<index.indexOf(canonical));
  for(const asset of [shared,pages,canonical])assert.equal(worker.split('./'+asset).length-1,1);
  assert.match(worker,/development-canonical-cards-no-legacy-people-v1/);
});

test('proven duplicate global definitions were actually removed',()=>{
  assert.equal((style.match(/^\.body\{/gm)||[]).length,1);
  assert.equal((tokens.match(/^\.toast,/gm)||[]).length,1);
  assert.equal((style.match(/^\.toast(?:[.{])/gm)||[]).length,0);
  assert.equal((style.match(/--app-primary\s*:/g)||[]).length,0);
});
