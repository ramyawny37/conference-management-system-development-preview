'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const test=require('node:test');

const runtime=fs.readFileSync('js/supabase/canonical-template-library.js','utf8');
const migration=fs.readFileSync('supabase/migrations/20261021193000_canonical_library_template_read.sql','utf8');
const edge=fs.readFileSync('supabase/functions/platform-device-operation/index.ts','utf8');
const index=fs.readFileSync('index.html','utf8');
const worker=fs.readFileSync('service-worker.js','utf8');

function environment(){
  const calls=[],listeners={};
  let rows=[{templateType:'house',templateId:'h1',payload:{id:'h1',name:'House'},revision:2}];
  const context={window:null,Promise,JSON,Object,String,Number,Array,Error,
    appData:{templates:[{id:'local'}],houseTemplates:[{id:'local-house'}],trash:{}},
    crypto:{randomUUID:()=> '10000000-0000-4000-8000-000000000001'},
    addEventListener(name,handler){listeners[name]=handler;},
    PlatformDeviceSession:{invokeModuleProtected(module,operation,args){
      calls.push({module,operation,args});
      if(operation==='list_library_templates')return Promise.resolve({status:'success',templates:rows});
      const current=rows.find(item=>item.templateType===args.p_template_type&&item.templateId===args.p_template_id);
      if(args.p_action==='delete'){
        current.deletedAt='2026-10-21T12:00:00Z';current.revision++;
        return Promise.resolve({status:'deleted',revision:current.revision});
      }
      if(current){current.payload=args.p_payload;current.deletedAt=null;current.revision++;}
      else rows.push({templateType:args.p_template_type,templateId:args.p_template_id,
        payload:args.p_payload,revision:1,deletedAt:null});
      return Promise.resolve({status:current?'updated':'created',revision:current?current.revision:1});
    }}
  };
  context.window=context;
  vm.runInNewContext(runtime,context,{filename:'canonical-template-library.js'});
  return {api:context.CanonicalTemplateLibrary,calls,listeners,appData:context.appData};
}

test('canonical template read and write use only the protected Platform session',async()=>{
  const value=environment();
  await value.api.hydrate();
  assert.equal(value.api.list('house')[0].payload.name,'House');
  await value.api.mutate('house','h1','upsert',{id:'h1',name:'Changed'});
  assert.deepEqual(value.calls.map(call=>call.operation),[
    'list_library_templates','apply_library_template_content_operation','list_library_templates'
  ]);
  assert.equal(value.calls.every(call=>call.module==='platform'),true);
  assert.equal(value.calls[1].args.p_base_revision,2);
  assert.equal(value.api.list('house')[0].payload.name,'Changed');
  assert.equal(value.appData.houseTemplates[0].name,'Changed');
});

test('delete and restore remain central and hydrate the active and trash projections',async()=>{
  const value=environment();
  await value.api.hydrate();
  await value.api.mutate('house','h1','delete',null);
  assert.deepEqual(value.appData.houseTemplates,[]);
  assert.equal(value.appData.trash.houseTemplates[0].payload.name,'House');
  await value.api.mutate('house','h1','upsert',{id:'h1',name:'Restored'});
  assert.equal(value.appData.houseTemplates[0].name,'Restored');
  assert.deepEqual(value.appData.trash.houseTemplates,[]);
  assert.equal(value.calls[3].args.p_base_revision,3);
});

test('session reset removes hydrated template data',async()=>{
  const value=environment();
  await value.api.hydrate();
  value.listeners['platform-session-reset']();
  assert.deepEqual(value.api.list(),[]);
  assert.deepEqual(value.appData.houseTemplates,[]);
});

test('SQL and Edge expose one approved-device personal template read',()=>{
  assert.match(migration,/create or replace function public\.list_library_templates/);
  assert.match(migration,/require_current_approved_device/);
  assert.match(migration,/where owner_user_id=actor_id/);
  assert.match(migration,/'deletedAt',deleted_at/);
  assert.match(migration,/payload=case when p_action='upsert' then p_payload else payload end/);
  assert.match(migration,/revoke all on function public\.list_library_templates\(uuid\)/);
  assert.match(migration,/when ''list_library_templates'' then/);
  assert.match(edge,/platform\.add\('list_library_templates'\)/);
  assert.match(edge,/platform\.add\('apply_library_template_content_operation'\)/);
  assert.match(index,/canonical-template-library\.js\?rev=canonical-template-read-write-v2/);
  assert.match(worker,/canonical-template-library\.js\?rev=canonical-template-read-write-v2/);
});
