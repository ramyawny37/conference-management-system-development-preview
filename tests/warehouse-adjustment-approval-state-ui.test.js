'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {JSDOM}=require('jsdom');

const source=fs.readFileSync('js/warehouse/remaining-operations.js','utf8');
const workspace=fs.readFileSync('js/warehouse/workspace.js','utf8');

function badge(status){const labels={draft:'مسودة',posted:'مرحّل',approved:'معتمد',pending:'بانتظار الاعتماد',rejected:'مرفوض'};return '<span data-status="'+status+'">'+(labels[status]||status)+'</span>';}
function harness(documents,details){
  const dom=new JSDOM('<section id="warehouseWorkspace"></section>',{url:'https://example.test/',runScripts:'outside-only'}),window=dom.window,calls=[];
  window.prompt=()=>null;
  vm.runInContext(source,dom.getInternalVMContext());
  const deps={state:{master:{items:[],units:[],itemUnits:[]},stores:[{id:'s1',name:'S1',status:'active'},{id:'s2',name:'S2',status:'active'}],storeContextValidated:false},esc:value=>String(value==null?'':value),field:(label,control)=>'<label>'+label+control+'</label>',heading:(title,text)=>'<h2>'+title+'</h2><p>'+text+'</p>',sectionHeading:(title,text)=>'<h3>'+title+'</h3><p>'+text+'</p>',statusBadge:badge,empty:()=>'<div>empty</div>',table:(headers,rows)=>'<table><tbody>'+rows+'</tbody></table>',render:(section,html)=>{window.document.getElementById('warehouseWorkspace').innerHTML=html;},data:()=>({}),feedback:()=>{},setBusy:()=>{},warehouseError:()=>'',mutate:(name,args,section)=>{calls.push({name,args,section});return Promise.resolve({});},invoke:(name,args)=>{if(name==='list_item_master')return Promise.resolve({items:[],units:[],itemUnits:[]});if(name==='list_documents')return Promise.resolve(documents);if(name==='get_document')return Promise.resolve(details[args.p_document_id]);if(name==='list_balances')return Promise.resolve([]);throw new Error('unexpected '+name);}};
  return {window,deps,calls,api:window.WarehouseRemainingOperations};
}
function row(window,id){return window.document.querySelector('[data-wh-operation-detail="'+id+'"]').closest('tr');}

test('approval-required adjustment rows reconcile lifecycle and approval state',async()=>{
  const documents=[
    {id:'not',document_number:'NOT',document_kind:'adjustment',status:'draft',approval_status:'not_submitted',revision:1},
    {id:'rejected',document_number:'REJ',document_kind:'adjustment',status:'draft',approval_status:'rejected',revision:2},
    {id:'pending',document_number:'PEN',document_kind:'adjustment',status:'draft',approval_status:'pending',revision:2},
    {id:'approved',document_number:'APP',document_kind:'adjustment',status:'draft',approval_status:'approved',revision:2},
    {id:'posted',document_number:'POST',document_kind:'adjustment',status:'posted',approval_status:'approved',revision:3}
  ],details=Object.fromEntries(documents.map(document=>[document.id,{header:document,lines:[]}])) ,h=harness(documents,details);
  await h.api.adjustments(h.deps);
  assert.ok(row(h.window,'not').querySelector('[data-wh-operation-action="submit_adjustment_for_approval"]'));
  assert.ok(row(h.window,'not').querySelector('[data-wh-operation-cancel]'));
  assert.ok(row(h.window,'rejected').querySelector('[data-wh-operation-action="submit_adjustment_for_approval"]'));
  assert.equal(row(h.window,'rejected').querySelector('[data-wh-operation-cancel]'),null);
  assert.match(row(h.window,'pending').textContent,/بانتظار الاعتماد/);
  assert.equal(row(h.window,'pending').querySelector('[data-wh-operation-action],[data-wh-operation-cancel]'),null);
  assert.match(row(h.window,'approved').textContent,/معتمد/);
  const post=row(h.window,'approved').querySelector('[data-wh-operation-action="post_adjustment"]');
  assert.ok(post);assert.equal(post.dataset.rev,'2');
  post.click();await Promise.resolve();
  assert.equal(h.calls[0].name,'post_adjustment');assert.equal(h.calls[0].args.p_document_id,'approved');assert.equal(h.calls[0].args.p_expected_revision,2);assert.equal(h.calls[0].section,'adjustments');
  assert.equal(row(h.window,'posted').querySelector('[data-wh-operation-action],[data-wh-operation-cancel]'),null);
});

test('detail panel shows approval separately and disables pending or approved editing',async()=>{
  const documents=[{id:'pending',document_kind:'adjustment',status:'draft',approval_status:'pending',revision:2},{id:'approved',document_kind:'adjustment',status:'draft',approval_status:'approved',revision:2},{id:'rejected',document_kind:'adjustment',status:'draft',approval_status:'rejected',revision:2}],details=Object.fromEntries(documents.map(document=>[document.id,{header:document,lines:[]}])) ,h=harness(documents,details);
  await h.api.adjustments(h.deps);
  for(const id of ['pending','approved']){row(h.window,id).querySelector('[data-wh-operation-detail]').click();await new Promise(resolve=>setImmediate(resolve));const panel=h.window.document.querySelector('[data-wh-operation-detail-panel]');assert.match(panel.textContent,/حالة الاعتماد/);assert.equal(panel.querySelector('[data-wh-save-operation-draft]'),null);}
  row(h.window,'rejected').querySelector('[data-wh-operation-detail]').click();await new Promise(resolve=>setImmediate(resolve));
  assert.ok(h.window.document.querySelector('[data-wh-save-operation-draft]'));
});

test('opening balance and transfer draft behavior remains unchanged',async()=>{
  const opening={id:'opening',document_kind:'opening_balance',status:'draft',approval_status:'not_required',revision:1},openingHarness=harness([opening],{opening:{header:opening,lines:[]}});
  openingHarness.api.setAdjustmentMode('opening_balance');await openingHarness.api.adjustments(openingHarness.deps);
  assert.ok(row(openingHarness.window,'opening').querySelector('[data-wh-operation-action="post_adjustment"]'));
  assert.ok(row(openingHarness.window,'opening').querySelector('[data-wh-operation-cancel]'));
  const transfer={id:'transfer',document_kind:'transfer',status:'draft',revision:4},transferHarness=harness([transfer],{transfer:{header:transfer,lines:[]}});
  await transferHarness.api.transfers(transferHarness.deps);
  assert.ok(row(transferHarness.window,'transfer').querySelector('[data-wh-operation-action="post_transfer"]'));
  assert.ok(row(transferHarness.window,'transfer').querySelector('[data-wh-operation-cancel]'));
});

test('successful mutation reload failure is not reclassified as a server failure',()=>{
  assert.match(workspace,/invoke\(name,args\)\.then\(function\(result\)\{finishMutation\(\);return load\(s\)\.then\(function\(\)\{feedback\('تم حفظ البيانات بنجاح\.',true\);return result;\},function\(\)\{feedback\('تم حفظ البيانات بنجاح\.',true\);return result;\}\);\},function\(e\)/);
  assert.match(workspace,/function\(e\)\{finishMutation\(\);feedback\(remainingWarehouseError\(e\),false\);throw e;\}/);
});

test('runtime and service-worker revisions publish one coherent asset set',()=>{
  const index=fs.readFileSync('index.html','utf8'),worker=fs.readFileSync('service-worker.js','utf8');
  assert.match(index,/remaining-operations\.js\?rev=adjustment-approval-state-v1/);
  assert.match(index,/workspace\.js\?rev=adjustment-approval-state-v1/);
  assert.match(worker,/development-3-4-0-adjustment-approval-state-v1/);
  assert.match(worker,/remaining-operations\.js\?rev=adjustment-approval-state-v1/);
  assert.match(worker,/workspace\.js\?rev=adjustment-approval-state-v1/);
});
