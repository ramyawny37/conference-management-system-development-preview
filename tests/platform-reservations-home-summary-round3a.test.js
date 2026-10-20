'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const test=require('node:test');
const vm=require('node:vm');

const dashboard=fs.readFileSync('js/platform-home-dashboard.js','utf8');
const html=fs.readFileSync('index.html','utf8');
const migration=fs.readFileSync('supabase/migrations/20261020072812_reservations_platform_dashboard_summary.sql','utf8');

function createDashboard(reservationResults){
  const nodes=new Map(['platformHomeConnectivity','platformHomeModules','platformHomeActivity','platformHomeActions','platformHomeAlerts'].map(id=>[id,{innerHTML:'',textContent:'',classList:{add(){},remove(){}},addEventListener(){}}]));
  const calls=[];
  let syncTask=null;
  const refreshButton={addEventListener(name,handler){if(name==='click')this.handler=handler;}};
  const window={
    navigator:{onLine:true},
    document:{getElementById:id=>nodes.get(id)||null,querySelector:selector=>selector==='[data-platform-home-refresh]'?refreshButton:null},
    addEventListener(){},
    StartupConferenceDiscovery:{refresh(){return Promise.resolve({ok:true,data:{conferences:[{id:'conference-selected',name:'المؤتمر المختار',status:'active',startDate:'2026-10-01'}]}});}},
    PlatformOperationalSync:{registerTask(id,interval,task){assert.equal(id,'platform_home');assert.equal(interval,30000);syncTask=task;},unregisterTask(){}},
    DeviceAuthorizationAdministrationService:{listSystemOwnerPendingDevices(){return Promise.resolve({ok:false});}},
    PlatformIntegration:{getModuleServices(){return {
      getSelectedConferenceId(){return 'conference-selected';},
      invokeProtected(module,operation,args){
        calls.push({module,operation,args});
        if(operation==='check_module_access')return Promise.resolve({status:'allowed',moduleKey:module});
        if(module==='reservations'&&operation==='get_dashboard_summary'){
          const result=reservationResults.shift();
          return result instanceof Error?Promise.reject({code:result.message}):Promise.resolve(result);
        }
        if(module==='warehouse'&&operation==='discover_stores')return Promise.resolve([]);
        if(module==='warehouse'&&operation==='list_item_master')return Promise.resolve({items:[]});
        if(module==='warehouse'&&operation==='list_approval_queue')return Promise.resolve([]);
        throw new Error(module+':'+operation);
      }
    };}}
  };
  vm.runInNewContext(dashboard,{window,Promise,Object,JSON,String,Array,Number,Date,Math});
  return {window,nodes,calls,refreshButton,getSyncTask:()=>syncTask};
}

function summary(bookings){
  return {scope:'platform',events:2,standaloneEvents:1,conferenceEvents:1,bookings,bookingMetricsAvailable:true,bookingMetricsComplete:true,activities:[
    {eventId:'standalone',name:'نشاط مستقل',status:'active',scopeType:'standalone',startDate:'2026-10-02',bookings:2},
    {eventId:'linked',name:'نشاط مؤتمر',status:'active',scopeType:'conference',conferenceId:'conference-selected',startDate:'2026-10-03',bookings:bookings-2}
  ]};
}

test('platform total uses the protected platform scope and includes standalone and conference activities once',async()=>{
  const fixture=createDashboard([summary(5)]);
  await fixture.window.PlatformHomeDashboard.activate();
  const reads=fixture.calls.filter(call=>call.module==='reservations'&&call.operation==='get_dashboard_summary');
  assert.equal(reads.length,1);
  assert.deepEqual(JSON.parse(JSON.stringify(reads[0].args)),{p_scope_type:'platform'});
  assert.doesNotMatch(JSON.stringify(reads[0].args),/conference-selected|p_conference_id/);
  assert.match(fixture.nodes.get('platformHomeModules').innerHTML,/5 حجز · 2 نشاط/);
  assert.match(fixture.nodes.get('platformHomeActivity').innerHTML,/نشاط مستقل/);
  assert.match(fixture.nodes.get('platformHomeActivity').innerHTML,/نشاط مرتبط بمؤتمر/);
});

test('manual and coordinated refresh both read a fresh platform total',async()=>{
  const fixture=createDashboard([summary(5),summary(6),summary(7)]);
  await fixture.window.PlatformHomeDashboard.activate();
  await fixture.window.PlatformHomeDashboard.refresh();
  assert.match(fixture.nodes.get('platformHomeModules').innerHTML,/6 حجز/);
  await fixture.getSyncTask()();
  assert.match(fixture.nodes.get('platformHomeModules').innerHTML,/7 حجز/);
  assert.equal(fixture.calls.filter(call=>call.module==='reservations'&&call.operation==='get_dashboard_summary').length,3);
});

test('a backend failure is rendered as an error and never as a misleading zero',async()=>{
  const fixture=createDashboard([new Error('RESERVATIONS_READ_FAILED')]);
  await fixture.window.PlatformHomeDashboard.activate();
  assert.match(fixture.nodes.get('platformHomeModules').innerHTML,/تعذر تحميل ملخص الحجوزات/);
  assert.doesNotMatch(fixture.nodes.get('platformHomeModules').innerHTML,/0 حجز/);
  assert.match(fixture.nodes.get('platformHomeAlerts').innerHTML,/RESERVATIONS_READ_FAILED/);
});

test('backend contract filters visible activities and booking totals at the event permission boundary',()=>{
  assert.match(migration,/user_has_module_permission_for\(v_actor,'reservations\.event\.view','event',e\.id::text\)/);
  assert.match(migration,/user_has_module_permission_for\(v_actor,'reservations\.booking\.view','event',e\.id::text\)/);
  assert.match(migration,/where event_row\.can_view_event/);
  assert.match(migration,/case when event_row\.can_view_bookings then/);
  assert.match(migration,/'bookingMetricsAvailable',coalesce\(bool_or\(can_view_bookings\),false\)/);
  assert.match(migration,/where booking\.event_id=event_row\.id/);
  assert.doesNotMatch(dashboard,/\.from\(|\.rpc\(|localStorage|indexedDB/);
});

test('existing event and conference scopes remain accepted while platform scope is explicit',()=>{
  assert.match(migration,/if p_args \? ''p_scope_type'' then/);
  assert.match(migration,/elsif p_args \? ''p_event_id'' then/);
  assert.match(migration,/array\[''p_conference_id''\]/);
  assert.match(migration,/return reservations_private\.read_scoped\(p_device_id,p_operation,p_args\)/);
  assert.match(migration,/revoke all on function reservations_private\.platform_dashboard_summary\(uuid\)[\s\S]*from public,anon,authenticated,service_role/);
});

test('general home keeps its name while Conference navigation says لوحة المؤتمرات without changing its route hook',()=>{
  assert.match(html,/data-platform-home[\s\S]*?<span>الرئيسية<\/span><\/button>/);
  assert.match(html,/data-conference-home>لوحة المؤتمرات<\/button>/);
  assert.doesNotMatch(html,/data-conference-home>الرئيسية<\/button>/);
});
