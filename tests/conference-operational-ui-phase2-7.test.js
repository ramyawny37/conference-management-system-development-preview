const assert=require('assert');
const fs=require('fs');
const path=require('path');
const vm=require('vm');

const LOCAL='11111111-1111-4111-8111-111111111111';
const USER='22222222-2222-4222-8222-222222222222';
const DEVICE='33333333-3333-4333-8333-333333333333';
const CLOUD='44444444-4444-4444-8444-444444444444';

function loadUi(overrides={}){
  const sandbox=Object.assign({
    console,Promise,Date,JSON,Object,Array,String,Number,RegExp,
    structuredClone:value=>JSON.parse(JSON.stringify(value)),
    navigator:{onLine:true},
    confirm:()=>true
  },overrides);
  sandbox.window=sandbox;
  vm.runInNewContext(fs.readFileSync(path.join(
    __dirname,'..','js','sync','conference-operational-ui.js'
  ),'utf8'),sandbox,{filename:'conference-operational-ui.js'});
  return sandbox;
}

function lifecycle(cloudLifecycle,metadata=null){
  return {
    localConferenceId:LOCAL,
    localLifecycle:'active',
    cloudLifecycle,
    localContentVersion:1,
    publishMetadata:metadata
  };
}

(async function(){
  const repositorySandbox={
    console,JSON,Object,Array,String,Number,Date,
    structuredClone:value=>JSON.parse(JSON.stringify(value))
  };
  repositorySandbox.window=repositorySandbox;
  vm.runInNewContext(fs.readFileSync(path.join(
    __dirname,'..','js','storage','conference-repository.js'
  ),'utf8'),repositorySandbox,{filename:'conference-repository.js'});
  [
    {authenticated:false},
    {accountStatus:'pending'},
    {accountStatus:'blocked'},
    {offline:true}
  ].forEach(function(){
    const added=repositorySandbox.ConferenceRepository
      .addLocalConference({conferences:[]},{
        id:LOCAL,name:'Local'
      });
    assert.strictEqual(added.ok,true);
    const record=added.data.conferenceLifecycle.records[LOCAL];
    assert.strictEqual(record.localLifecycle,'active');
    assert.strictEqual(record.cloudLifecycle,'unpublished');
    assert.strictEqual(record.publishMetadata,null);
  });

  const sandbox=loadUi();
  const presenter=sandbox.ConferenceOperationalStatusPresenter;
  const access={
    source:'server',fresh:true,authenticated:true,
    accountStatus:'approved',canCreateConferences:true
  };
  const base={
    localConferenceId:LOCAL,
    systemAccess:access,
    queue:{queueStatus:'idle'},
    realtime:{status:'inactive'},
    online:true
  };
  const states={
    unpublished:'محفوظ على هذا الجهاز فقط.',
    local_only:'محفوظ محليًا فقط.',
    waiting_for_authorization:'بانتظار السماح بالنشر.',
    ready_to_publish:'جاهز للنشر.',
    publishing:'تجهيز محاولة النشر.',
    publish_failed:'فشل النشر.'
  };
  Object.keys(states).forEach(state=>{
    const metadata=state==='publishing'
      ?{lastPublishStage:'attempt_persisted'}:null;
    const view=presenter.present(Object.assign({},base,{
      lifecycle:lifecycle(state,metadata)
    }));
    assert.strictEqual(view.primaryStatus,states[state],state);
    assert.ok(!view.primaryStatus.includes(state));
  });

  const linked=presenter.present(Object.assign({},base,{
    lifecycle:lifecycle('cloud_linked'),
    link:{
      knownRevision:1,
      syncState:{pendingLocalChanges:false}
    },
    realtime:{status:'subscribed'}
  }));
  assert.strictEqual(linked.isCloudLinked,true);
  assert.match(linked.primaryStatus,/مرتبط بالسحابة/);
  assert.match(linked.secondaryStatus,/متصل بالتحديثات/);

  const pending=presenter.present(Object.assign({},base,{
    lifecycle:lifecycle('unpublished'),
    systemAccess:Object.assign({},access,{
      accountStatus:'pending',canCreateConferences:false
    })
  }));
  assert.ok(!pending.availableActions.includes('publish'));
  const blocked=presenter.present(Object.assign({},base,{
    lifecycle:lifecycle('unpublished'),
    systemAccess:Object.assign({},access,{
      accountStatus:'blocked',canCreateConferences:false
    })
  }));
  assert.ok(!blocked.availableActions.includes('publish'));

  assert.strictEqual(
    presenter.queuePresentation({queueStatus:'processing'}).label,
    'جارٍ رفع التغييرات.'
  );
  assert.strictEqual(
    presenter.realtimePresentation({
      status:'subscribed',remoteChangeDetected:true
    },true).code,
    'remote_change_detected'
  );
  const conflict=presenter.present(Object.assign({},base,{
    lifecycle:lifecycle('cloud_linked'),
    link:{knownRevision:2,syncState:{}},
    realtime:{status:'suspended',potentialConflict:true}
  }));
  assert.strictEqual(conflict.requiresManualReview,true);
  assert.match(conflict.primaryStatus,/لم تُحذف البيانات المحلية/);
  assert.deepStrictEqual(
    Array.from(conflict.availableActions),['review']
  );

  assert.strictEqual(
    presenter.recoveryPresentation({
      reconciliationState:'retryable_same_operation'
    }).label,
    'يمكن استكمال نفس محاولة النشر.'
  );
  assert.doesNotMatch(
    presenter.errorPresentation(
      'SUPABASE_REQUEST_FAILED token=secret'
    ),
    /secret|token|SUPABASE/
  );

  let appData={
    conferences:[{id:LOCAL,name:'Local'}],
    conferenceLifecycle:{
      schemaVersion:1,
      records:{[LOCAL]:lifecycle('unpublished')}
    }
  };
  let confirmation;
  let publishCalls=0;
  let resolvePublish;
  const publishPromise=new Promise(resolve=>{resolvePublish=resolve;});
  const manager={
    transitionAppData(data,id,action){
      const next=JSON.parse(JSON.stringify(data));
      const record=next.conferenceLifecycle.records[id];
      if(action==='request_publish'){
        record.cloudLifecycle='waiting_for_authorization';
        record.publishMetadata={publishIntent:'publish_requested'};
      }else if(action==='authorize'){
        record.cloudLifecycle='ready_to_publish';
      }
      return {ok:true,status:'transitioned',data:next};
    },
    publishConference(data,id,value){
      publishCalls++;
      confirmation=value;
      return publishPromise;
    },
    reconcileConference(){
      return Promise.resolve({ok:false,status:'manual_review_required'});
    }
  };
  let persisted=0;
  const controllerSandbox=loadUi({
    appData,
    ConferenceRepository:{
      getLifecycle(data,id){
        const record=data.conferenceLifecycle.records[id];
        return record
          ?{ok:true,status:'found',data:JSON.parse(JSON.stringify(record))}
          :{ok:false,status:'not_found'};
      }
    },
    ConferencePublishManager:manager,
    SystemAccessService:{
      refresh(){
        return Promise.resolve(Object.assign({},access,{
          userId:USER,checkedAt:'2026-07-30T10:00:00.000Z'
        }));
      },
      getState(){return access;}
    },
    SupabaseAuth:{getSession(){return {user:{id:USER}};}},
    SupabaseDeviceIdentity:{getOrCreate(){return {id:DEVICE};}},
    StorageRepository:{
      saveAppSnapshot(value){persisted++;appData=value;return Promise.resolve();}
    }
  });
  const first=controllerSandbox.ConferenceCloudActionsController.publish(
    LOCAL,{
      getAppData:()=>appData,
      applyAppData:value=>{appData=value;},
      publishManager:manager,
      repository:controllerSandbox.ConferenceRepository,
      systemAccess:controllerSandbox.SystemAccessService,
      auth:controllerSandbox.SupabaseAuth,
      device:controllerSandbox.SupabaseDeviceIdentity,
      persistAppData:value=>{
        persisted++;
        appData=value;
        return Promise.resolve();
      },
      confirm:()=>true
    }
  );
  const duplicate=
    await controllerSandbox.ConferenceCloudActionsController.publish(
      LOCAL
    );
  assert.strictEqual(duplicate.status,'already_running');
  await new Promise(resolve=>setImmediate(resolve));
  assert.strictEqual(publishCalls,1);
  assert.strictEqual(persisted,1);
  assert.strictEqual(confirmation.confirmed,true);
  assert.strictEqual(confirmation.userId,USER);
  assert.strictEqual(confirmation.confirmedByUserId,USER);
  assert.strictEqual(confirmation.localConferenceId,LOCAL);
  assert.ok(!Object.prototype.hasOwnProperty.call(
    confirmation,'operationId'
  ));
  assert.ok(!Object.prototype.hasOwnProperty.call(
    confirmation,'requestedCloudId'
  ));
  resolvePublish({ok:true,status:'cloud_linked',data:{appData}});
  assert.strictEqual((await first).ok,true);

  let cancelledPublish=0;
  const cancelled=loadUi({
    appData,
    ConferenceRepository:controllerSandbox.ConferenceRepository,
    ConferencePublishManager:Object.assign({},manager,{
      publishConference(){cancelledPublish++;return Promise.resolve();}
    }),
    SystemAccessService:controllerSandbox.SystemAccessService,
    SupabaseAuth:controllerSandbox.SupabaseAuth,
    confirm:()=>false
  });
  const cancelledResult=
    await cancelled.ConferenceCloudActionsController.publish(LOCAL,{
      getAppData:()=>appData,
      repository:cancelled.ConferenceRepository,
      publishManager:cancelled.ConferencePublishManager,
      systemAccess:cancelled.SystemAccessService,
      auth:cancelled.SupabaseAuth,
      confirm:()=>false
    });
  assert.strictEqual(cancelledResult.status,'confirmation_cancelled');
  assert.strictEqual(cancelledPublish,0);

  let stopped=0;
  let realtimeStopped=0;
  const logout=loadUi({
    AutomaticSyncOrchestrator:{
      stop(){stopped++;return {promise:Promise.resolve()};}
    },
    AutomaticQueueRunner:{stop(){stopped++;}},
    ConferenceRealtimeManager:{
      stopAll(){realtimeStopped++;return Promise.resolve();}
    }
  });
  const localBefore=JSON.stringify(appData);
  await logout.ConferenceOperationalUI.logoutCleanup();
  assert.strictEqual(stopped,2);
  assert.strictEqual(realtimeStopped,1);
  assert.strictEqual(JSON.stringify(appData),localBefore);

  const html=controllerSandbox.ConferenceOperationalUI.renderSection({
    localConference:{id:LOCAL},
    options:{
      getAppData:()=>appData,
      repository:controllerSandbox.ConferenceRepository,
      systemAccess:{getState(){return access;}},
      links:{get(){return null;}},
      queueRunner:{getState(){return {queueStatus:'idle'};}},
      realtimeManager:{getState(){return {status:'inactive'};}}
    }
  });
  assert.match(html,/dir="rtl"/);
  assert.match(html,/aria-live="polite"/);
  assert.match(html,/aria-label=/);
  assert.doesNotMatch(html,/operationId|requestedCloudId|payload/i);

  const source=fs.readFileSync(path.join(
    __dirname,'..','js','sync','conference-operational-ui.js'
  ),'utf8');
  assert.doesNotMatch(source,/crypto\.randomUUID|createUuid|uid\(/);
  assert.doesNotMatch(source,/knownRevision\s*=/);
  assert.doesNotMatch(source,/applyRemoteSnapshot|applySnapshot/);
  assert.doesNotMatch(source,/conference\.name\s*===|name\s*===.*conference/);
  assert.doesNotMatch(source,
    /(?:startup|login|online)[\s\S]{0,80}publishConference\s*\(/i);
  const startupSource=fs.readFileSync(path.join(
    __dirname,'..','script.js'
  ),'utf8');
  const gatePosition=startupSource.indexOf(
    'window.StartupAccessGate.run'
  );
  const storagePosition=startupSource.indexOf(
    'Promise.resolve(completeApplicationStartup())'
  );
  const discoveryPosition=startupSource.indexOf(
    'window.StartupConferenceDiscovery.refresh'
  );
  const linkingPosition=startupSource.indexOf(
    'window.AutomaticConferenceLinking.initialize'
  );
  const orchestratorPosition=startupSource.lastIndexOf(
    'window.AutomaticSyncOrchestrator.start'
  );
  assert.ok(gatePosition>=0,'startup must remain guarded by StartupAccessGate');
  assert.ok(storagePosition>=0&&storagePosition<discoveryPosition);
  assert.ok(discoveryPosition<linkingPosition);
  assert.ok(linkingPosition<orchestratorPosition);
  assert.doesNotMatch(startupSource,
    /openNewConferenceModal\(mode\)\s*\{[\s\S]{0,120}systemAccessAllowsConferenceCreation/);

  console.log('conference operational UI phase 2.7 tests: passed');
})().catch(error=>{
  console.error(error);
  process.exitCode=1;
});
