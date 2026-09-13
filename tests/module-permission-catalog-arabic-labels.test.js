'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const migration=fs.readFileSync(path.join(__dirname,'..','supabase','migrations','20260913173000_module_permission_catalog_arabic_labels.sql'),'utf8');

const expected={
  reservations:[
    'reservations.assignment.manage','reservations.attendance.manage','reservations.attendance.view',
    'reservations.booking.cancel','reservations.booking.create','reservations.booking.delete',
    'reservations.booking.update','reservations.booking.view','reservations.event.manage',
    'reservations.event.view','reservations.operations.manage','reservations.operations.view',
    'reservations.payment.record','reservations.payment.view','reservations.payment.void',
    'reservations.reports.view','reservations.stay.check_in','reservations.stay.check_out'
  ],
  warehouse:[
    'warehouse.import.stage','warehouse.item.create','warehouse.item.update','warehouse.item.view',
    'warehouse.party.manage','warehouse.party.view','warehouse.reports.export','warehouse.reports.view',
    'warehouse.stock.adjust','warehouse.stock.approve','warehouse.stock.issue','warehouse.stock.post',
    'warehouse.stock.receive','warehouse.stock.transfer','warehouse.store.create','warehouse.store.update',
    'warehouse.store.view'
  ]
};

test('Arabic permission-label migration is presentation-only and atomic',()=>{
  assert.match(migration,/^\s*begin\s*;/i);
  assert.match(migration,/commit\s*;\s*$/i);
  assert.match(migration,/update\s+public\.module_permission_catalog/i);
  assert.doesNotMatch(migration,/^\s*(insert\s+into|delete\s+from|alter\s+table|drop\s+(table|function|trigger|policy)|create\s+(table|function|trigger|policy)|grant\s+|revoke\s+)/im);
  assert.doesNotMatch(migration,/\b(status|sensitive_mutation|allowed_scope_mode|allowed_resource_type)\s*=/i);
  assert.match(migration,/set\s+display_name\s*=\s*labels\.display_name\s*,\s*description\s*=\s*labels\.description/i);
});

test('all current Warehouse and Reservations catalog keys have Arabic labels',()=>{
  for(const [moduleKey,keys] of Object.entries(expected)){
    for(const key of keys){
      const escaped=key.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
      assert.match(migration,new RegExp("\\('"+moduleKey+"','"+escaped+"','[^\\x00-\\x7F]+"));
    }
  }
});

test('stable permission keys are only matched, never rewritten',()=>{
  assert.doesNotMatch(migration,/set\s+permission_key\s*=/i);
  assert.doesNotMatch(migration,/set\s+module_key\s*=/i);
  assert.match(migration,/catalog\.module_key\s*=\s*labels\.module_key/i);
  assert.match(migration,/catalog\.permission_key\s*=\s*labels\.permission_key/i);
});
