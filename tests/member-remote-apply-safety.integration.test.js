const assert=require('assert');
const fs=require('fs');
const path=require('path');
const vm=require('vm');

const source=fs.readFileSync(path.join(
  __dirname,'../js/sync/discovered-conference-open-service.js'
),'utf8');

function clone(value){return JSON.parse(JSON.stringify(value));}

function createEnvironment(settings={}){
  let account='member-user';
  const stableClient={id:'client-a'};
  const remoteId='11111111-1111-4111-8111-111111111111';
  const localId='local-member-1';
  const queueWrites={count:0};
  const publishWrites={count:0};
  const rpcWrites={count:0};
  let downloadCount=0;
  let activationCount=0;
  const persistCalls=[];
  const revisions=settings.revisions||[3];
  let revisionIndex=0;
  let activeRevision=3;
  let currentData=clone(settings.initialData||{
    conferences:[{
      id:localId,
      name:'Local Revision 2',
      status:'active',
      peopleDb:{people:[{id:'old-p'}]},
      houses:[],
      transports:[],
      activityLog:[],
      accommodation:{units:[{id:'a-old'}]},
      restaurant:{orders:[{id:'r-old'}]},
      accounts:{ledger:[{id:'acc-old'}]}
    }],
    currentConferenceId:null
  });
  let memory=clone(currentData);
  const contexts={};
  const links={
    [localId]:clone(settings.link||{
      localConferenceId:localId,
      remoteConferenceId:remoteId,
      knownRevision:2,
      linkStatus:'linked',
      pendingLocalApplication:false,
      syncState:{pendingLocalChanges:settings.pendingLocalChanges===true}
    })
  };

  function snapshotForRevision(revision){
    return {
      id:'cloud-template',
      name:'Cloud Revision '+String(revision),
      status:'active',
      peopleDb:{people:[{id:'p1'},{id:'p2'},{id:'p3'}]},
      houses:[{floors:[{rooms:[
        {closed:false,guests:['p1'],children:['p2']},
        {closed:false,guests:['p3'],children:[]}
      ]}]}],
      transports:[{id:'t1'},{id:'t2'}],
      activityLog:[{id:'log-1'},{id:'log-2'}],
      accommodation:{units:[{id:'a1'},{id:'a2'}]},
      restaurant:{orders:[{id:'o1'}]},
      restaurantV3:{mealPriceOverrides:[{id:'rp1'}],
        mealCountOverrides:[{id:'rc1'}],personOverrides:[{id:'rv1'}]},
      accommodationV3:{roomOverrides:[{id:'ar1'},{id:'ar2'}],
        personOverrides:[{id:'ap1'}]},
      airConditioningV3:{roomOverrides:[{id:'ac1'},{id:'ac2'}],
        dayOverrides:[{id:'ad1'}]},
      financialV3:{adjustments:[{id:'f1'},{id:'f2'}]},
      accounts:{ledger:[{id:'acc-1'},{id:'acc-2'}]}
    };
  }

  const sandbox={
    window:null,
    structuredClone:clone,
    Promise,Date,JSON,Object,Array,String,Number,Math,RegExp,
    SupabaseAuth:{getState:()=>({user:{id:account}})},
    SupabaseClientLayer:{getClient:()=>stableClient},
    StartupConferenceDiscovery:{getRecord:()=>null},
    SupabaseSnapshotSync:{
      listAvailableConferences:()=>Promise.resolve({
        ok:true,
        data:{conferences:[{id:remoteId,name:'Cloud conf',deletedAt:null}]}
      }),
      inspectInitialSnapshot:()=>{
        activeRevision=revisions[Math.min(revisionIndex,revisions.length-1)];
        if(revisionIndex<revisions.length-1)revisionIndex++;
        return Promise.resolve({
          ok:true,status:'found',
          data:{revision:activeRevision,schemaVersion:'1',appVersion:'test'}
        });
      },
      downloadSnapshot:()=>Promise.resolve({
        ok:(downloadCount++,true),
        status:'downloaded',
        data:{
          revision:activeRevision,
          schemaVersion:'1',
          appVersion:'test',
          snapshot:snapshotForRevision(activeRevision)
        }
      })
    },
    ConferenceMembersService:{getCurrentAccess:()=>Promise.resolve(
      settings.membershipDenied===true
        ?{ok:false,status:'access_denied'}
        :{ok:true,status:'available',data:{role:'viewer',userId:account}}
    )},
    CurrentDeviceAuthorizationService:{getStatus:()=>Promise.resolve({
      ok:settings.deviceDenied!==true,
      data:{deviceAuthorizationStatus:
        settings.deviceDenied===true?'blocked':'approved'}
    })},
    SystemAccessService:{refresh:()=>Promise.resolve({
      source:'server',
      fresh:settings.systemFresh!==false,
      authenticated:settings.systemAuthenticated!==false,
      accountStatus:settings.systemApproved===false?'pending':'approved'
    })},
    FullBackupService:{
      isFullRestoreCloudReviewPending:()=>settings.restoreIsolation===true,
      isManualRelinkRequired:()=>settings.manualRelink===true
    },
    ConferenceLinkStore:{
      get:id=>links[id]?clone(links[id]):null,
      findByRemoteId:id=>Object.values(links).find(item=>item.remoteConferenceId===id)||null,
      save:input=>{
        links[input.localConferenceId]=clone(input);
        return {ok:true,status:'saved',data:clone(input)};
      },
      remove:id=>{delete links[id];return {ok:true,status:'removed'};}
    },
    ConferenceRepository:{
      addLocalConference(data,conference){
        const next=clone(data);
        next.conferences=(next.conferences||[]).concat([clone(conference)]);
        return {ok:true,data:next};
      }
    },
    StorageRepository:{
      getAppSnapshot:()=>Promise.resolve({data:clone(currentData)}),
      saveAppSnapshot:value=>{
        persistCalls.push(clone(value));
        currentData=clone(value);
        return Promise.resolve({ok:true,status:'saved'});
      }
    },
    normalizeAppDataCandidate:value=>clone(value),
    uid:()=>localId,
    OfflineFirstIntegration:{
      configureConferenceSync:(lid,options)=>{
        contexts[lid]={
          localConferenceId:lid,
          conferenceId:options.conferenceId,
          baseRevision:options.baseRevision,
          schemaVersion:options.schemaVersion,
          appVersion:options.appVersion
        };
        return {ok:true,status:'configured',data:{context:clone(contexts[lid])}};
      }
    },
    activatePersistedConferenceById:()=>{activationCount++;return true;},
    OfflineSyncQueue:{coalesceSnapshotOperation:()=>{queueWrites.count++;}},
    ConferencePublishingEngine:{publish:()=>{publishWrites.count++;}},
    SupabaseRpc:{rpc:()=>{rpcWrites.count++;}},
    appData:memory
  };
  sandbox.window=sandbox;
  vm.runInNewContext(source,sandbox,{filename:'discovered-conference-open-service.js'});

  return {
    api:sandbox.DiscoveredConferenceOpenService,
    localId,
    remoteId,
    contexts,
    links,
    getStored:()=>clone(currentData),
    getPersistCalls:()=>persistCalls.map(clone),
    getDownloadCount:()=>downloadCount,
    getActivationCount:()=>activationCount,
    queueWrites,
    publishWrites,
    rpcWrites
  };
}

(async function run(){
  const failures=[];
  function capture(name,fn){
    return Promise.resolve().then(fn).then(function(){
      console.log(name+': passed');
    }).catch(function(error){
      failures.push(name+': '+String(error&&error.message||error));
    });
  }

  // Positive path contract: linked member should apply cloud rev3 once,
  // then ignore duplicate revision event.
  await capture('positive-path-duplicate-noop',async function(){
    const env=createEnvironment({revisions:[3,3]});
    const first=await env.api.refreshLinkedLocalConference(env.localId);
    assert.strictEqual(
      first.ok,
      true,
      'first refresh must succeed, got '+JSON.stringify(first)
    );
    assert.strictEqual(first.status,'opened','first refresh should open/apply');
    assert.strictEqual(env.links[env.localId].knownRevision,3,
      'knownRevision should update to 3');
    assert.strictEqual(env.contexts[env.localId].baseRevision,3,
      'context.baseRevision should update to 3');
    const afterFirst=env.getStored();
    assert.strictEqual(afterFirst.conferences.length,1,
      'must keep single local conference');
    assert.strictEqual(afterFirst.conferences[0].peopleDb.people.length,3);
    assert.strictEqual(afterFirst.conferences[0].houses.length,1);
    assert.strictEqual(afterFirst.conferences[0].transports.length,2);
    assert.strictEqual(afterFirst.conferences[0].activityLog.length,2);
    assert.strictEqual(afterFirst.conferences[0].accommodation.units.length,2);
    assert.strictEqual(afterFirst.conferences[0].restaurant.orders.length,1);
    assert.strictEqual(afterFirst.conferences[0].accounts.ledger.length,2);
    assert.strictEqual(afterFirst.conferences[0].financialV3.adjustments.length,2);
    assert.strictEqual(afterFirst.conferences[0].airConditioningV3.roomOverrides.length,2);
    assert.strictEqual(afterFirst.currentConferenceId,env.localId,
      'refresh should restore the linked conference selection');
    assert.strictEqual(env.getActivationCount(),1,
      'applied refresh should activate and re-render once');
    assert.strictEqual(env.queueWrites.count,0,'must not enqueue queue writes');
    assert.strictEqual(env.publishWrites.count,0,'must not publish from refresh');
    assert.strictEqual(env.rpcWrites.count,0,'must not write RPC from refresh');
    const trace=env.api.getState();
    ['downloadedCounts','materializedCounts','persistedCounts',
      'readAfterWriteCounts'].forEach(function(stage){
      assert.strictEqual(trace[stage].conferencePeopleDb,3,stage);
      assert.strictEqual(trace[stage].assignedPeople,3,stage);
      assert.strictEqual(trace[stage].houses,1,stage);
      assert.strictEqual(trace[stage].activeRooms,2,stage);
      assert.strictEqual(trace[stage].transports,2,stage);
      assert.strictEqual(trace[stage].activityLog,2,stage);
      assert.strictEqual(trace[stage].accommodationData,3,stage);
      assert.strictEqual(trace[stage].restaurantData,3,stage);
      assert.strictEqual(trace[stage].airConditioningData,3,stage);
      assert.strictEqual(trace[stage].accounts,2,stage);
      assert.strictEqual(trace[stage].financialCollections,2,stage);
    });

    const persistCountBeforeDuplicate=env.getPersistCalls().length;
    const downloadCountBeforeDuplicate=env.getDownloadCount();
    const second=await env.api.refreshLinkedLocalConference(env.localId);
    assert.strictEqual(second.ok,true,'duplicate refresh should still succeed');
    assert.strictEqual(second.status,'up_to_date','duplicate refresh should be no-op');
    assert.strictEqual(env.links[env.localId].knownRevision,3,
      'duplicate revision must keep knownRevision=3');
    assert.strictEqual(
      env.getPersistCalls().length,
      persistCountBeforeDuplicate,
      'duplicate revision must not re-apply/persist'
    );
    assert.strictEqual(
      env.getDownloadCount(),
      downloadCountBeforeDuplicate,
      'duplicate revision must not re-download'
    );
  });

  await capture('equal-revision-incomplete-materialization-repaired',async function(){
    const env=createEnvironment({
      revisions:[4],
      link:{
        localConferenceId:'local-member-1',
        remoteConferenceId:'11111111-1111-4111-8111-111111111111',
        knownRevision:4,
        linkStatus:'linked',
        pendingLocalApplication:false,
        syncState:{
          pendingLocalChanges:false,
          materializedSnapshotCounts:{
            conferencePeopleDb:3,assignedPeople:3,houses:1,
            activeRooms:2,transports:2,activityLog:2,
            restaurantData:3,accommodationData:3,
            airConditioningData:3,accounts:1,financialCollections:2
          }
        }
      }
    });
    const repaired=await env.api.refreshLinkedLocalConference(env.localId);
    assert.strictEqual(repaired.ok,true,JSON.stringify(repaired));
    assert.strictEqual(repaired.status,'opened');
    assert.strictEqual(env.getDownloadCount(),1,
      'equal revision with incomplete local content must re-download');
    const stored=env.getStored();
    assert.strictEqual(stored.conferences[0].peopleDb.people.length,3);
    assert.strictEqual(stored.conferences[0].transports.length,2);
    assert.strictEqual(stored.conferences[0].activityLog.length,2);
    const diagnostics=env.api.getState();
    assert.strictEqual(diagnostics.latestCloudRevision,4);
    assert.strictEqual(diagnostics.requestedRevision,4);
    assert.strictEqual(diagnostics.downloadedRevision,4);
    assert.strictEqual(diagnostics.extractedSnapshotValid,true);
    assert.strictEqual(diagnostics.currentConferenceContentComplete,true);
    assert.strictEqual(diagnostics.currentConferenceResolved,true);
    assert.strictEqual(diagnostics.settingsConferenceResolved,true);
  });

  // Counter path contract: pending local changes must fail-closed (no auto-apply).
  await capture('counter-path-pending-local-blocked',async function(){
    const env=createEnvironment({
      revisions:[3],
      pendingLocalChanges:true
    });
    const before=env.getStored();
    const result=await env.api.refreshLinkedLocalConference(env.localId);
    assert.strictEqual(result.ok,false,
      'pending local changes must block auto-apply');
    assert.ok(
      ['local_changes_pending','remote_update_review_required']
        .indexOf(result.status)>=0,
      'blocked refresh should return review-required status'
    );
    const after=env.getStored();
    assert.deepStrictEqual(after,before,
      'blocked refresh must keep local data unchanged');
    assert.strictEqual(env.links[env.localId].knownRevision,2,
      'blocked refresh must keep knownRevision unchanged');
    assert.strictEqual(env.queueWrites.count,0,
      'blocked refresh must not mutate queue');
    assert.strictEqual(env.publishWrites.count,0,
      'blocked refresh must not publish');
    assert.strictEqual(env.rpcWrites.count,0,
      'blocked refresh must not write RPC');
  });

  if(failures.length){
    console.error('member remote apply safety integration tests failed:');
    failures.forEach(function(message){console.error('- '+message);});
    process.exitCode=1;
    return;
  }

  console.log('member remote apply safety integration tests: passed');
})().catch(error=>{
  console.error(error);
  process.exitCode=1;
});
