'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const historical=fs.readFileSync('js/warehouse/historical-operations.js','utf8');
const remaining=fs.readFileSync('js/warehouse/remaining-operations.js','utf8');
const workspace=fs.readFileSync('js/warehouse/workspace.js','utf8');
const index=fs.readFileSync('index.html','utf8');
const worker=fs.readFileSync('service-worker.js','utf8');

function navigation(section,mode){
  const window={};window.window=window;
  vm.runInNewContext(historical,{window,Array,String,Object,Number,Date,Math});
  return window.WarehouseHistoricalOperations.operationsNav(section,mode);
}

test('Opening Balance horizontal tab is clickable and targets the existing mode',()=>{
  const html=navigation('receipts');
  assert.match(html,/data-wh-route="adjustments\?mode=opening_balance"[^>]*>أرصدة افتتاحية<\/button>/);
  assert.doesNotMatch(html,/<span[^>]*>أرصدة افتتاحية<\/span>/);
  assert.equal((workspace.match(/setAdjustmentMode\(mode\[1\]\)/g)||[]).length,2);
  assert.match(workspace,/function load\(route\)\{var requested=.*mode=\(opening_balance\|damage_loss\|correction\|adjustment\)/);
  assert.match(remaining,/adjustmentMode='adjustment'/);
  assert.equal((remaining.match(/function adjustments\(/g)||[]).length,1);
});

test('supported horizontal tabs remain clickable and Returns remains unavailable',()=>{
  const html=navigation('receipts');
  for(const pair of [['history','حركة المخزون'],['balances','رصيد المخازن'],['receipts','استلام / مشتريات'],['issues','صرف وتوزيع'],['transfers','تحويلات'],['adjustments?mode=damage_loss','تلف وفقد'],['adjustments?mode=adjustment','تسويات']])assert.match(html,new RegExp('data-wh-route="'+pair[0].replace('?','\\?')+'"[^>]*>'+pair[1]+'</button>'));
  assert.match(html,/<span aria-disabled="true">مرتجعات<\/span>/);
  assert.doesNotMatch(html,/data-wh-route="[^"]*returns/);
});

test('active state follows route and adjustment mode exactly',()=>{
  assert.match(navigation('receipts'),/data-wh-route="receipts" class="active">استلام \/ مشتريات/);
  assert.match(navigation('adjustments','opening_balance'),/data-wh-route="adjustments\?mode=opening_balance" class="active">أرصدة افتتاحية/);
  assert.doesNotMatch(navigation('adjustments','opening_balance'),/data-wh-route="adjustments\?mode=adjustment" class="active">تسويات/);
  assert.match(navigation('adjustments','adjustment'),/data-wh-route="adjustments\?mode=adjustment" class="active">تسويات/);
  assert.doesNotMatch(navigation('adjustments','adjustment'),/data-wh-route="adjustments\?mode=opening_balance" class="active">أرصدة افتتاحية/);
});

test('navigation assets and Development cache use one coherent revision',()=>{
  const revision='warehouse-opening-balance-navigation-v1';
  for(const file of ['historical-operations.js','remaining-operations.js','workspace.js']){
    assert.ok(index.includes('js/warehouse/'+file+'?rev='+revision));
    assert.ok(worker.includes('./js/warehouse/'+file+'?rev='+revision));
  }
  assert.ok(worker.includes('development-3-4-0-'+revision));
});
