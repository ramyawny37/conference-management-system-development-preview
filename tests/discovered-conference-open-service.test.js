const assert=require('assert');
const fs=require('fs');
const path=require('path');
const vm=require('vm');
const source=fs.readFileSync(path.join(
  __dirname,'../js/sync/discovered-conference-open-service.js'),'utf8');

function clone(value){return JSON.parse(JSON.stringify(value));}
function environment(settings={}){
  let account=settings.account||'user-a';
  let client=settings.client||{id:'client-a'};
  let stored=clone(settings.appData||{conferences:[],currentConferenceId:null});
  let memory=clone(stored);
  let activated=0,downloads=0,inspects=0,configured=0;
  let manualRelinkChecks=[];
  const forbidden={queue:0,publication:0,rpc:0};
  const events=[];
  const persistCounts={};
  const links={};
  const remoteId=settings.remoteId||'remote-1';
  const revisionSequence=Array.isArray(settings.revisionSequence)&&
    settings.revisionSequence.length
      ?settings.revisionSequence.slice()
      :[settings.revision||1];
  let revisionCursor=0;
  let inspectedRevision=null;
  function nextRevision(){
    const revision=revisionSequence[Math.min(
      revisionCursor,
      revisionSequence.length-1
    )];
    if(revisionCursor<revisionSequence.length-1)revisionCursor++;
    return revision;
  }
  function snapshotByRevision(revision){
    if(settings.snapshotByRevision&&settings.snapshotByRevision[revision]){
      return clone(settings.snapshotByRevision[revision]);
    }
    return clone(settings.snapshot||{
      id:'source-local',name:'Same',status:'active',peopleDb:{people:[]}
    });
  }
  const snapshot=clone(settings.snapshot||{
    id:'source-local',name:'Same',status:'active',peopleDb:{people:[]}
  });
  const listing={id:remoteId,name:'Same',role:settings.role||'viewer',deletedAt:null};
  if(settings.existingLink){
    links[settings.existingLink.localConferenceId]=clone(settings.existingLink);
  }
  let cached=settings.cached===false?null:{
    authenticatedUserId:account,discoveryGeneration:1,
    remoteConferenceId:remoteId,revision:1,schemaVersion:'1',
    conference:clone(snapshot),snapshot:clone(snapshot)
  };
  const sandbox={window:null,structuredClone:clone,
    SupabaseAuth:{getState:()=>({user:account?{id:account}:null})},
    SupabaseClientLayer:{getClient:()=>client},
    StartupConferenceDiscovery:{getRecord:()=>cached},
    SupabaseSnapshotSync:{
      listAvailableConferences:()=>Promise.resolve({
        ok:true,data:{conferences:settings.deleted?[
          Object.assign({},listing,{deletedAt:'2026-01-01'})
        ]:[listing]}
      }),
      inspectInitialSnapshot:()=>{inspects++;inspectedRevision=nextRevision();
        return Promise.resolve({
        ok:true,status:'found',data:{revision:inspectedRevision,
          schemaVersion:settings.schemaVersion||'1',appVersion:'test'}
      });},
      downloadSnapshot:()=>{downloads++;return Promise.resolve(settings.malformed
        ?{ok:true,status:'downloaded',data:{revision:1,snapshot:null}}
        :{ok:true,status:'downloaded',data:{revision:inspectedRevision||1,
          schemaVersion:settings.schemaVersion||'1',appVersion:'test',
          snapshot:snapshotByRevision(inspectedRevision||1)}});}
    },
    ConferenceMembersService:{getCurrentAccess:()=>Promise.resolve(
      settings.membershipDenied
        ?{ok:false,status:'access_denied'}
        :{ok:true,status:'available',data:{role:settings.role||'viewer'}}
    )},
    CurrentDeviceAuthorizationService:{getStatus:()=>Promise.resolve({
      ok:true,data:{deviceAuthorizationStatus:'approved'}
    })},
    SystemAccessService:{refresh:()=>Promise.resolve({
      source:'server',fresh:true,authenticated:true,accountStatus:'approved'
    })},
    FullBackupService:{
      isFullRestoreCloudReviewPending:()=>settings.restoreMarker===true,
      isManualRelinkRequired:localId=>{
        manualRelinkChecks.push(localId);
        return settings.manualRelink===true;
      }
    },
    OfflineSyncQueue:{coalesceSnapshotOperation:()=>{forbidden.queue++;}},
    ConferencePublishingEngine:{publish:()=>{forbidden.publication++;}},
    SupabaseRpc:{rpc:()=>{forbidden.rpc++;}},
    ConferenceLinkStore:{
      get:id=>links[id]?clone(links[id]):null,
      findByRemoteId:id=>Object.values(links).find(x=>x.remoteConferenceId===id)||null,
      save(input){
        events.push('link:'+input.linkStatus);
        if(typeof settings.onLink==='function'){
          settings.onLink(input.linkStatus,{
            logout:()=>{account='';},changeAccount:value=>{account=value;},
            replaceClient:value=>{client=value;},
            invalidate:()=>sandbox.DiscoveredConferenceOpenService.invalidate()
          });
        }
        if(settings.failLink===input.linkStatus){
          if(settings.ambiguousLink===input.linkStatus){
            links[input.localConferenceId]=clone(input);
          }
          return {ok:false,status:'failed'};
        }
        links[input.localConferenceId]=clone(input);
        return {ok:true,status:'saved',data:clone(input)};
      },
      remove(id){delete links[id];events.push('link:removed');return {ok:true};}
    },
    ConferenceRepository:{addLocalConference(data,conference){
      const next=clone(data);
      next.conferences=(next.conferences||[]).concat([clone(conference)]);
      return {ok:true,data:next};
    }},
    StorageRepository:{
      getAppSnapshot:()=>Promise.resolve({data:clone(stored)}),
      saveAppSnapshot(value){
        const root=value.conferenceImportRecovery||{};
        const stage=Object.keys(root).length>0;
        const promoted=value.conferences&&value.conferences.length>0;
        const current=!!value.currentConferenceId;
        events.push(current?'persist:current':promoted?'persist:promoted':
          stage?'persist:recovery':'persist:cleanup');
        persistCounts[events[events.length-1]]=
          (persistCounts[events[events.length-1]]||0)+1;
        if(typeof settings.onPersist==='function'){
          settings.onPersist(events[events.length-1],{
            logout:()=>{account='';},changeAccount:value=>{account=value;},
            replaceClient:value=>{client=value;},
            invalidate:()=>sandbox.DiscoveredConferenceOpenService.invalidate()
          },persistCounts[events[events.length-1]]);
        }
        if(settings.failPersist===events[events.length-1]&&
          (!settings.failPersistNth||settings.failPersistNth===
            persistCounts[events[events.length-1]])){
          return Promise.reject(new Error('storage failure'));
        }
        stored=clone(value);return Promise.resolve();
      }
    },
    appData:memory,
    normalizeAppDataCandidate:value=>{
      const next=clone(value);
      (next.conferences||[]).forEach(conference=>{
        conference.peopleDb=conference.peopleDb&&
          Array.isArray(conference.peopleDb.people)
          ?conference.peopleDb:{people:[]};
        conference.houses=Array.isArray(conference.houses)
          ?conference.houses:[];
        conference.transports=Array.isArray(conference.transports)
          ?conference.transports:[];
        conference.activityLog=Array.isArray(conference.activityLog)
          ?conference.activityLog:[];
      });
      return next;
    },
    uid:()=>settings.generatedId||'generated-local',
    OfflineFirstIntegration:{configureConferenceSync(){
      configured++;
      return settings.configureFailure?{ok:false}:{ok:true,status:'configured'};
    }},
    activatePersistedConferenceById(){
      activated++;
      if(settings.activationThrows)throw new Error('activation failed');
      return settings.activationFailure!==true;
    }
  };
  sandbox.window=sandbox;
  vm.runInNewContext(source,sandbox);
  return {api:sandbox.DiscoveredConferenceOpenService,events,links,
    stored:()=>clone(stored),memory:()=>clone(sandbox.appData),
    activated:()=>activated,configured:()=>configured,
    downloads:()=>downloads,inspects:()=>inspects,
    manualRelinkChecks:()=>manualRelinkChecks.slice(),
    forbidden:()=>clone(forbidden),
    setAccount:value=>{account=value;},replaceClient:value=>{client=value;},
    setCached:value=>{cached=value;},remoteId};
}

(async function(){
  const restoreIsolated=environment({restoreMarker:true,cached:false});
  const restoreResult=await restoreIsolated.api.open(restoreIsolated.remoteId);
  assert.strictEqual(restoreResult.status,'restore_isolated');
  assert.strictEqual(restoreIsolated.inspects(),0);
  assert.strictEqual(restoreIsolated.downloads(),0);
  assert.deepStrictEqual(restoreIsolated.events,[]);
  assert.strictEqual(Object.keys(restoreIsolated.links).length,0);
  assert.strictEqual(restoreIsolated.configured(),0);
  assert.strictEqual(restoreIsolated.activated(),0);
  assert.deepStrictEqual(restoreIsolated.forbidden(),{
    queue:0,publication:0,rpc:0
  });

  const manualRelink=environment({manualRelink:true,
    generatedId:'must-not-be-used'});
  const manualResult=await manualRelink.api.open(manualRelink.remoteId);
  assert.strictEqual(manualResult.status,'manual_relink_required');
  assert.deepStrictEqual(manualRelink.manualRelinkChecks(),['source-local']);
  assert.strictEqual(manualRelink.downloads(),0);
  assert.deepStrictEqual(manualRelink.events,[]);
  assert.strictEqual(Object.keys(manualRelink.links).length,0);
  assert.strictEqual(manualRelink.configured(),0);
  assert.strictEqual(manualRelink.activated(),0);
  assert.strictEqual(manualRelink.stored().conferences.length,0);
  assert.deepStrictEqual(manualRelink.forbidden(),{
    queue:0,publication:0,rpc:0
  });

  const first=environment();
  const opened=await first.api.open(first.remoteId);
  assert.strictEqual(opened.status,'opened');
  assert.deepStrictEqual(first.events,[
    'persist:recovery','link:server_selected_pending_local_apply',
    'persist:promoted','link:linked','persist:promoted','link:linked',
    'persist:current'
  ]);
  assert.strictEqual(first.downloads(),0,'matching discovery snapshot is reused');
  assert.strictEqual(first.stored().conferenceImportRecovery[first.remoteId],undefined);
  assert.strictEqual(first.stored().conferences.length,1);
  assert.strictEqual(first.activated(),1);
  assert.strictEqual(first.configured(),1);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(
    Object.values(first.links)[0],'membershipRole'),false);

  const repeated=environment();
  const one=repeated.api.open(repeated.remoteId);
  const two=repeated.api.open(repeated.remoteId);
  assert.strictEqual(one,two);
  await Promise.all([one,two]);
  assert.strictEqual(repeated.stored().conferences.length,1);

  const collision=environment({
    appData:{conferences:[{id:'source-local',name:'Existing',status:'active'}],
      currentConferenceId:null},generatedId:'collision-safe'
  });
  const collisionResult=await collision.api.open(collision.remoteId);
  assert.strictEqual(collisionResult.data.localConferenceId,'collision-safe');
  assert.strictEqual(collision.stored().conferences.length,2);

  const reuse=environment({
    appData:{conferences:[{id:'existing-local',name:'Same',status:'active'}],
      currentConferenceId:null},
    existingLink:{localConferenceId:'existing-local',remoteConferenceId:'remote-1',
      knownRevision:1,linkStatus:'linked'}
  });
  assert.strictEqual((await reuse.api.open(reuse.remoteId)).data.localConferenceId,
    'existing-local');
  assert.strictEqual(reuse.stored().conferences.length,1);

  const refreshSnapshot2={
    id:'source-local',name:'Rev-2',status:'active',
    peopleDb:{people:[{id:'p1'},{id:'p2'}]},
    houses:[{floors:[{rooms:[{closed:false,guests:['p1'],children:['p2']}]}]}],
    transports:[{id:'t1'}],
    activityLog:[{id:'a1'}]
  };
  const refreshSnapshot3={
    id:'source-local',name:'Rev-3',status:'active',
    peopleDb:{people:[{id:'p1'},{id:'p2'},{id:'p3'}]},
    houses:[{floors:[{rooms:[
      {closed:false,guests:['p1'],children:['p2']},
      {closed:false,guests:['p3'],children:[]}
    ]}]}],
    transports:[{id:'t1'},{id:'t2'}],
    activityLog:[{id:'a1'},{id:'a2'}]
  };
  const refreshSnapshot4={
    id:'source-local',name:'Rev-4',status:'active',
    peopleDb:{people:[{id:'p1'},{id:'p2'},{id:'p3'},{id:'p4'}]},
    houses:[{floors:[{rooms:[
      {closed:false,guests:['p1'],children:['p2']},
      {closed:false,guests:['p3'],children:['p4']}
    ]}]}],
    transports:[{id:'t1'},{id:'t2'},{id:'t3'}],
    activityLog:[{id:'a1'},{id:'a2'},{id:'a3'}]
  };
  const linkedRefresh=environment({
    cached:false,
    revisionSequence:[2,3,4],
    snapshotByRevision:{2:refreshSnapshot2,3:refreshSnapshot3,4:refreshSnapshot4},
    appData:{conferences:[{id:'existing-local',name:'Local stale',status:'active',
      peopleDb:{people:[{id:'old'}]},houses:[],transports:[],activityLog:[]}],
      currentConferenceId:null},
    existingLink:{localConferenceId:'existing-local',remoteConferenceId:'remote-1',
      knownRevision:1,linkStatus:'linked',pendingLocalApplication:false,
      syncState:{pendingLocalChanges:false,initialSnapshotComplete:true}}
  });
  const linkedOpen=await linkedRefresh.api.open(linkedRefresh.remoteId);
  assert.strictEqual(linkedOpen.status,'opened');
  assert.strictEqual(linkedRefresh.downloads(),1);
  assert.strictEqual(linkedRefresh.stored().conferences.length,1);
  assert.strictEqual(linkedRefresh.stored().currentConferenceId,'existing-local');
  assert.strictEqual(Object.values(linkedRefresh.links)[0].knownRevision,2);
  assert.strictEqual(Object.values(linkedRefresh.links)[0].pendingLocalApplication,
    false);
  assert.strictEqual(linkedRefresh.stored().conferences[0].peopleDb.people.length,2);
  assert.deepStrictEqual(linkedRefresh.forbidden(),{queue:0,publication:0,rpc:0});
  const refreshOne=await linkedRefresh.api.refreshLinkedLocalConference('existing-local');
  assert.strictEqual(refreshOne.status,'opened');
  const refreshTwo=await linkedRefresh.api.refreshLinkedLocalConference('existing-local');
  assert.strictEqual(refreshTwo.status,'opened');
  assert.strictEqual(linkedRefresh.stored().conferences.length,1);
  assert.strictEqual(linkedRefresh.stored().conferences[0].name,'Rev-4');
  assert.strictEqual(Object.values(linkedRefresh.links)[0].knownRevision,4);
  assert.strictEqual(Object.values(linkedRefresh.links)[0].syncState.pendingLocalChanges,
    false);
  assert.strictEqual(linkedRefresh.downloads(),3);
  const diagnostics=linkedRefresh.api.getDiagnostics();
  assert.strictEqual(diagnostics.ok,true);
  assert.ok(Array.isArray(diagnostics.data.events));
  assert.ok(diagnostics.data.events.some(entry=>entry.status==='applied'));

  const completeEmptyCounts={conferencePeopleDb:0,assignedPeople:0,houses:0,
    activeRooms:0,transports:0,activityLog:0,restaurantData:0,
    accommodationData:0,airConditioningData:0,accounts:0,
    financialCollections:0};
  const legacyShellRepair=environment({cached:false,revision:4,
    snapshotByRevision:{4:refreshSnapshot4},
    appData:{conferences:[{id:'existing-local',name:'Shell',status:'active',
      peopleDb:{people:[]},houses:[],transports:[],activityLog:[]}],
      currentConferenceId:'existing-local'},
    existingLink:{localConferenceId:'existing-local',remoteConferenceId:'remote-1',
      knownRevision:4,linkStatus:'linked',pendingLocalApplication:false,
      syncState:{pendingLocalChanges:false,
        materializedSnapshotCounts:completeEmptyCounts,
        downloadedSnapshotCounts:completeEmptyCounts}}
  });
  const legacyRepairResult=await legacyShellRepair.api
    .refreshLinkedLocalConference('existing-local');
  assert.strictEqual(legacyRepairResult.status,'opened');
  assert.strictEqual(legacyShellRepair.downloads(),1);
  assert.strictEqual(legacyShellRepair.stored().conferences[0].houses.length,1);
  assert.strictEqual(legacyShellRepair.memory().conferences[0]
    .houses[0].floors[0].rooms.length,2);
  assert.strictEqual(legacyShellRepair.stored().currentConferenceId,
    'existing-local');
  const repairedState=Object.values(legacyShellRepair.links)[0].syncState;
  assert.strictEqual(repairedState.downloadedSnapshotRevision,4);
  assert.strictEqual(repairedState.materializedSnapshotRevision,4);
  assert.strictEqual(repairedState.materializationStatus,'verified');
  assert.strictEqual(repairedState.materializationSource,'downloaded');
  assert.deepStrictEqual(repairedState.downloadedSnapshotCounts,
    repairedState.materializedSnapshotCounts);
  const repairDiagnostics=legacyShellRepair.api.getDiagnostics().data;
  assert.deepStrictEqual(repairDiagnostics.materializedCounts,
    repairDiagnostics.persistedCounts);
  assert.deepStrictEqual(repairDiagnostics.persistedCounts,
    repairDiagnostics.readAfterWriteCounts);
  const runtimeTrace=legacyShellRepair.api.getState();
  assert.strictEqual(runtimeTrace.runtimeBuildRevision,'member-runtime-trace-v1');
  assert.strictEqual(runtimeTrace.metadataRequestReached,true);
  assert.strictEqual(runtimeTrace.downloadRequestReached,true);
  assert.strictEqual(runtimeTrace.materializationTrusted,true);
  assert.strictEqual(runtimeTrace.materializationComplete,true);
  assert.strictEqual(runtimeTrace.activationReached,true);

  const trustedEmpty=environment({cached:false,revision:4,
    appData:{conferences:[{id:'existing-local',name:'Empty',status:'active',
      peopleDb:{people:[]},houses:[],transports:[],activityLog:[]}],
      currentConferenceId:'existing-local'},
    existingLink:{localConferenceId:'existing-local',remoteConferenceId:'remote-1',
      knownRevision:4,linkStatus:'linked',pendingLocalApplication:false,
      syncState:{pendingLocalChanges:false,materializationStatus:'verified',
        materializationSource:'downloaded',
        materializationVerifiedAt:'2026-08-04T00:00:00.000Z',
        downloadedSnapshotRevision:4,materializedSnapshotRevision:4,
        downloadedSnapshotCounts:completeEmptyCounts,
        materializedSnapshotCounts:completeEmptyCounts}}
  });
  assert.strictEqual((await trustedEmpty.api.refreshLinkedLocalConference(
    'existing-local')).status,'up_to_date');
  assert.strictEqual(trustedEmpty.downloads(),0);
  assert.deepStrictEqual(trustedEmpty.events,[]);

  const staleProvenance=environment({cached:false,revision:4,
    snapshotByRevision:{4:refreshSnapshot4},
    appData:{conferences:[{id:'existing-local',name:'Old',status:'active',
      peopleDb:{people:[]},houses:[],transports:[],activityLog:[]}],
      currentConferenceId:'existing-local'},
    existingLink:{localConferenceId:'existing-local',remoteConferenceId:'remote-1',
      knownRevision:4,linkStatus:'linked',pendingLocalApplication:false,
      syncState:{pendingLocalChanges:false,materializationStatus:'verified',
        materializationVerifiedAt:'2026-08-04T00:00:00.000Z',
        downloadedSnapshotRevision:2,materializedSnapshotRevision:2,
        downloadedSnapshotCounts:completeEmptyCounts,
        materializedSnapshotCounts:completeEmptyCounts}}
  });
  assert.strictEqual((await staleProvenance.api.refreshLinkedLocalConference(
    'existing-local')).status,'opened');
  assert.strictEqual(staleProvenance.downloads(),1);
  assert.strictEqual(staleProvenance.stored().conferences[0].houses.length,1);

  const pendingShell=environment({cached:false,revision:4,
    snapshotByRevision:{4:refreshSnapshot4},
    appData:{conferences:[{id:'existing-local',name:'Pending shell',status:'active',
      peopleDb:{people:[]},houses:[],transports:[],activityLog:[]}],
      currentConferenceId:'existing-local'},
    existingLink:{localConferenceId:'existing-local',remoteConferenceId:'remote-1',
      knownRevision:4,linkStatus:'linked',pendingLocalApplication:false,
      syncState:{pendingLocalChanges:true,
        materializedSnapshotCounts:completeEmptyCounts}}
  });
  const pendingShellResult=await pendingShell.api
    .refreshLinkedLocalConference('existing-local');
  assert.strictEqual(pendingShellResult.status,'remote_update_review_required');
  assert.strictEqual(pendingShell.inspects(),1);
  assert.strictEqual(pendingShell.downloads(),0);
  assert.strictEqual(pendingShell.stored().conferences[0].houses.length,0);

  const repeatAfterRepair=await legacyShellRepair.api
    .refreshLinkedLocalConference('existing-local');
  assert.strictEqual(repeatAfterRepair.status,'up_to_date');
  assert.strictEqual(legacyShellRepair.downloads(),1);

  const refreshDenied=environment({
    cached:false,
    revision:2,
    membershipDenied:true,
    appData:{conferences:[{id:'existing-local',name:'Local stale',status:'active'}],
      currentConferenceId:null},
    existingLink:{localConferenceId:'existing-local',remoteConferenceId:'remote-1',
      knownRevision:1,linkStatus:'linked',pendingLocalApplication:false}
  });
  const deniedResult=await refreshDenied.api.refreshLinkedLocalConference(
    'existing-local'
  );
  assert.strictEqual(deniedResult.status,'membership_unavailable');
  assert.strictEqual(refreshDenied.stored().conferences[0].name,'Local stale');
  assert.deepStrictEqual(refreshDenied.forbidden(),{queue:0,publication:0,rpc:0});

  const notLinked=environment({cached:false,revision:2,appData:{
    conferences:[{id:'existing-local',name:'Local',status:'active'}],
    currentConferenceId:null
  }});
  assert.strictEqual((await notLinked.api.refreshLinkedLocalConference(
    'existing-local'
  )).status,'not_linked');

  const redownload=environment({revision:2});
  await redownload.api.open(redownload.remoteId);
  assert.strictEqual(redownload.downloads(),1);

  const deleted=environment({deleted:true});
  assert.strictEqual((await deleted.api.open(deleted.remoteId)).status,
    'conference_unavailable');
  assert.strictEqual(deleted.events.length,0);

  const malformed=environment({cached:false,malformed:true});
  assert.strictEqual((await malformed.api.open(malformed.remoteId)).status,
    'snapshot_unavailable');
  assert.strictEqual(malformed.events.length,0);

  const storageFailure=environment({failPersist:'persist:recovery'});
  assert.strictEqual((await storageFailure.api.open(storageFailure.remoteId)).status,
    'recovery_persistence_failed');
  assert.strictEqual(Object.keys(storageFailure.links).length,0);

  const linkFailure=environment({failLink:'server_selected_pending_local_apply'});
  assert.strictEqual((await linkFailure.api.open(linkFailure.remoteId)).status,
    'pending_link_failed');
  assert.strictEqual(linkFailure.stored().conferences.length,0);

  const finalLinkFailure=environment({failLink:'linked'});
  assert.strictEqual((await finalLinkFailure.api.open(finalLinkFailure.remoteId)).status,
    'link_finalization_failed');
  assert.strictEqual(finalLinkFailure.stored().conferences.length,1);
  assert.ok(finalLinkFailure.stored().conferenceImportRecovery[finalLinkFailure.remoteId]);
  assert.strictEqual(finalLinkFailure.stored().currentConferenceId,null);
  assert.strictEqual(Object.values(finalLinkFailure.links)[0].linkStatus,
    'server_selected_pending_local_apply');

  const foreign=environment({appData:{conferences:[],currentConferenceId:null,
    conferenceImportRecovery:{'remote-1':{
      remoteConferenceId:'remote-1',localConferenceId:'foreign-local',
      revision:1,authenticatedUserId:'user-b',status:'normalized_persisted',
      snapshot:{id:'foreign-local',status:'active'}
    }}}});
  assert.strictEqual((await foreign.api.open(foreign.remoteId)).status,
    'foreign_recovery');
  assert.ok(foreign.stored().conferenceImportRecovery[foreign.remoteId]);

  const stale=environment({cached:false});
  const pending=stale.api.open(stale.remoteId);
  stale.replaceClient({id:'client-b'});
  stale.api.invalidate();
  assert.strictEqual((await pending).status,'stale');
  assert.strictEqual(stale.activated(),0);

  const viewer=environment({role:'transport_viewer'});
  const viewerResult=await viewer.api.open(viewer.remoteId);
  assert.strictEqual(viewerResult.data.role,'transport_viewer');
  assert.strictEqual(Object.prototype.hasOwnProperty.call(
    Object.values(viewer.links)[0],'membershipRole'),false);

  const missingLocal=environment({existingLink:{
    localConferenceId:'missing-local',remoteConferenceId:'remote-1',
    knownRevision:1,linkStatus:'linked',pendingLocalApplication:false
  }});
  assert.strictEqual((await missingLocal.api.open(missingLocal.remoteId)).status,
    'link_recovery_required');
  assert.strictEqual(missingLocal.events.length,0);
  assert.strictEqual(Object.values(missingLocal.links)[0].linkStatus,'linked');

  const reservedCollision=environment({appData:{conferences:[],
    currentConferenceId:null,conferenceImportRecovery:{'remote-other':{
      remoteConferenceId:'remote-other',localConferenceId:'source-local',
      revision:1,authenticatedUserId:'user-a',status:'normalized_persisted',
      snapshot:{id:'source-local',name:'Reserved',status:'active'}
    }}},generatedId:'recovery-safe'});
  const reservedResult=await reservedCollision.api.open(reservedCollision.remoteId);
  assert.strictEqual(reservedResult.data.localConferenceId,'recovery-safe');

  const unsupported=environment({schemaVersion:'2'});
  assert.strictEqual((await unsupported.api.open(unsupported.remoteId)).status,
    'snapshot_unsupported');
  assert.strictEqual(unsupported.events.length,0);

  const promotionFailure=environment({
    failPersist:'persist:promoted',failPersistNth:1
  });
  assert.strictEqual((await promotionFailure.api.open(
    promotionFailure.remoteId)).status,'promotion_persistence_failed');
  assert.strictEqual(promotionFailure.stored().currentConferenceId,null);
  assert.strictEqual(Object.values(promotionFailure.links)[0].linkStatus,
    'server_selected_pending_local_apply');

  const cleanupFailure=environment({
    failPersist:'persist:promoted',failPersistNth:2
  });
  assert.strictEqual((await cleanupFailure.api.open(
    cleanupFailure.remoteId)).status,'recovery_cleanup_failed');
  assert.ok(cleanupFailure.stored().conferenceImportRecovery[
    cleanupFailure.remoteId]);
  assert.strictEqual(Object.values(cleanupFailure.links)[0].linkStatus,
    'server_selected_pending_local_apply');

  const currentFailure=environment({failPersist:'persist:current'});
  assert.strictEqual((await currentFailure.api.open(currentFailure.remoteId)).status,
    'activation_persistence_failed');
  assert.strictEqual(currentFailure.stored().currentConferenceId,null);
  assert.strictEqual(currentFailure.activated(),0);

  const ambiguous=environment({
    failLink:'linked',ambiguousLink:'linked'
  });
  assert.strictEqual((await ambiguous.api.open(ambiguous.remoteId)).status,'opened');
  assert.strictEqual(Object.values(ambiguous.links)[0].linkStatus,'linked');

  const ambiguousPending=environment({
    failLink:'server_selected_pending_local_apply',
    ambiguousLink:'server_selected_pending_local_apply'
  });
  assert.strictEqual((await ambiguousPending.api.open(
    ambiguousPending.remoteId)).status,'opened');

  const staleChecks=[];
  [
    {kind:'persist',name:'persist:recovery',nth:1},
    {kind:'link',name:'server_selected_pending_local_apply'},
    {kind:'persist',name:'persist:promoted',nth:1},
    {kind:'link',name:'linked'},
    {kind:'persist',name:'persist:promoted',nth:2},
    {kind:'persist',name:'persist:current',nth:1}
  ].forEach(function(stage){
    ['logout','account','client'].forEach(function(kind){
      var fired=false;
      var change=function(actions){
        if(kind==='logout')actions.logout();
        if(kind==='account')actions.changeAccount('user-b');
        if(kind==='client')actions.replaceClient({id:'replacement'});
        actions.invalidate();
      };
      var settings={onPersist:function(actual,actions,nth){
        if(fired||stage.kind!=='persist'||actual!==stage.name||nth!==stage.nth)return;
        fired=true;
        change(actions);
      },onLink:function(actual,actions){
        if(fired||stage.kind!=='link'||actual!==stage.name)return;
        fired=true;
        change(actions);
      }};
      var stale=environment(settings);
      staleChecks.push(stale.api.open(stale.remoteId).then(function(outcome){
        assert.strictEqual(outcome.status,'stale');
        assert.strictEqual(stale.stored().currentConferenceId,null);
        assert.strictEqual(stale.activated(),0);
        var staleLink=Object.values(stale.links)[0];
        assert.ok(!staleLink||staleLink.linkStatus!== 'linked'||
          !stale.stored().conferenceImportRecovery[stale.remoteId]);
      }));
    });
  });
  await Promise.all(staleChecks);

  const stagedData={conferences:[{id:'resume-local',name:'Same',status:'active'}],
    currentConferenceId:null,conferenceImportRecovery:{'remote-1':{
      remoteConferenceId:'remote-1',localConferenceId:'resume-local',revision:1,
      authenticatedUserId:'user-a',status:'normalized_persisted',
      snapshot:{id:'resume-local',name:'Same',status:'active',
        peopleDb:{people:[{id:'person-1'},{id:'person-2'}]},
        houses:[{floors:[{rooms:[{guests:['person-1'],children:['person-2']}]}]}],
        transports:[{id:'transport-1'}],
        activityLog:[{id:'activity-1'},{id:'activity-2'}]}
    }}};
  const resumed=environment({appData:stagedData,existingLink:{
    localConferenceId:'resume-local',remoteConferenceId:'remote-1',knownRevision:1,
    linkStatus:'server_selected_pending_local_apply',pendingLocalApplication:true
  }});
  assert.strictEqual((await resumed.api.open(resumed.remoteId)).status,'opened');
  assert.strictEqual(resumed.stored().conferences.length,1);
  assert.strictEqual(
    resumed.stored().conferences[0].peopleDb.people.length,2,
    'recovery promotion must replace an existing shell with the snapshot'
  );
  assert.strictEqual(resumed.stored().conferences[0].transports.length,1);
  assert.strictEqual(resumed.stored().conferences[0].activityLog.length,2);
  assert.strictEqual(resumed.stored().conferenceImportRecovery[resumed.remoteId],
    undefined);

  const missingLocalRecovery=clone(stagedData);
  missingLocalRecovery.conferences=[];
  const resumedMissing=environment({appData:missingLocalRecovery,existingLink:{
    localConferenceId:'resume-local',remoteConferenceId:'remote-1',knownRevision:1,
    linkStatus:'server_selected_pending_local_apply',pendingLocalApplication:true
  }});
  assert.strictEqual((await resumedMissing.api.open(
    resumedMissing.remoteId)).status,'opened');
  assert.strictEqual(resumedMissing.stored().conferences[0].id,'resume-local');

  const changedRevision=environment({appData:stagedData,revision:2,
    existingLink:{localConferenceId:'resume-local',remoteConferenceId:'remote-1',
      knownRevision:1,linkStatus:'server_selected_pending_local_apply',
      pendingLocalApplication:true}});
  assert.strictEqual((await changedRevision.api.open(
    changedRevision.remoteId)).status,'recovery_cleaned_revision_changed');
  assert.strictEqual(changedRevision.stored().conferences.length,0);
  assert.strictEqual(Object.keys(changedRevision.links).length,0);

  const cleanup=environment({appData:stagedData,existingLink:{
    localConferenceId:'resume-local',remoteConferenceId:'remote-1',knownRevision:1,
    linkStatus:'server_selected_pending_local_apply',pendingLocalApplication:true
  }});
  assert.strictEqual((await cleanup.api.cleanupRecovery(cleanup.remoteId)).status,
    'recovery_cleaned');
  assert.strictEqual(cleanup.stored().conferences.length,0);

  const activationFailure=environment({activationFailure:true});
  assert.strictEqual((await activationFailure.api.open(
    activationFailure.remoteId)).status,'runtime_activation_failed');
  assert.strictEqual(activationFailure.stored().currentConferenceId,null);

  const activationThrow=environment({activationThrows:true});
  assert.strictEqual((await activationThrow.api.open(
    activationThrow.remoteId)).status,'runtime_activation_failed');
  assert.strictEqual(activationThrow.stored().currentConferenceId,null);

  const discoverySource=fs.readFileSync(path.join(
    __dirname,'../js/sync/startup-conference-discovery.js'),'utf8');
  assert.doesNotMatch(discoverySource,/DiscoveredConferenceOpenService\.open/);
  const scriptSource=fs.readFileSync(path.join(__dirname,'../script.js'),'utf8');
  assert.match(scriptSource,
    /else\{\s*html \+= '<article class="startup-conference-card" onclick="openConferenceFromStartup/);
  assert.match(scriptSource,
    /onclick="openDiscoveredConferenceFromStartup\(\\''\+conf\.__startupDiscoveredRemoteId/);
  console.log('discovered conference open service tests passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
