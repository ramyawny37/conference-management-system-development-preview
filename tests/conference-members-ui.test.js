'use strict';

var assert=require('assert');
var fs=require('fs');
var path=require('path');
var vm=require('vm');

var source=fs.readFileSync(path.resolve(
  __dirname,'../js/sync/conference-members-ui.js'
),'utf8');
var indexSource=fs.readFileSync(path.resolve(
  __dirname,'../index.html'
),'utf8');
var scriptSource=fs.readFileSync(path.resolve(
  __dirname,'../script.js'
),'utf8');
var serviceWorkerSource=fs.readFileSync(path.resolve(
  __dirname,'../service-worker.js'
),'utf8');
var ids={
  localA:'local-a',
  localB:'local-b',
  remoteA:'22222222-2222-4222-8222-222222222222',
  remoteB:'33333333-3333-4333-8333-333333333333',
  owner:'44444444-4444-4444-8444-444444444444',
  manager:'55555555-5555-4555-8555-555555555555'
};

function deferred(){
  var resolve;
  var reject;
  var promise=new Promise(function(resolveValue,rejectValue){
    resolve=resolveValue;
    reject=rejectValue;
  });
  return {promise:promise,resolve:resolve,reject:reject};
}

function access(role){
  return {
    ok:true,
    status:'available',
    data:{
      role:role||'owner',
      canManageMembers:(role||'owner')==='owner'
    }
  };
}

function list(members){
  return {
    ok:true,
    status:'listed',
    data:{members:members||[]}
  };
}

function environment(overrides){
  overrides=overrides||{};
  var current={id:ids.localA};
  var links={
    'local-a':{remoteConferenceId:ids.remoteA},
    'local-b':{remoteConferenceId:ids.remoteB}
  };
  var elements={
    conference_members_content:{innerHTML:''},
    conference_member_lookup_email:{value:'manager@example.test'},
    conference_member_role:{value:'manager'}
  };
  var calls=[];
  var service=overrides.service||{
    getCurrentAccess:function(input){
      calls.push({method:'getCurrentAccess',input:input});
      return Promise.resolve(access('owner'));
    },
    listMembers:function(input){
      calls.push({method:'listMembers',input:input});
      return Promise.resolve(list([{
        userId:ids.owner,
        displayName:'Owner',
        role:'owner',
        isCurrentUser:true
      },{
        userId:ids.manager,
        displayName:'Manager',
        role:'manager',
        isCurrentUser:false
      }]));
    },
    lookupUser:function(input){
      calls.push({method:'lookupUser',input:input});
      return Promise.resolve({
        ok:true,status:'found',data:{
          targetUserId:ids.manager,
          displayName:'Manager'
        }
      });
    },
    addMember:function(input,role){
      calls.push({method:'addMember',input:input,role:role});
      return Promise.resolve({
        ok:true,status:'added',data:{replayed:false}
      });
    },
    addManager:function(input){
      return this.addMember(input,'manager');
    },
    changeRole:function(input,role){
      calls.push({method:'changeRole',input:input,role:role});
      return Promise.resolve({
        ok:true,status:'role_changed',data:{replayed:false}
      });
    },
    removeMember:function(input){
      calls.push({method:'removeMember',input:input});
      return Promise.resolve({
        ok:true,status:'removed',data:{replayed:false}
      });
    },
    removeManager:function(input){
      return this.removeMember(input);
    }
  };
  var sandbox={
    window:null,
    Promise:Promise,
    Object:Object,
    String:String,
    Array:Array,
    console:console,
    document:{
      getElementById:function(id){return elements[id]||null;}
    },
    getCurrentConference:function(){return current;},
    ConferenceLinkStore:{
      get:function(localId){return links[localId]||null;}
    },
    ConferenceMembersService:service,
    confirm:function(){return true;}
  };
  sandbox.window=sandbox;
  vm.runInNewContext(source,sandbox,{
    filename:'conference-members-ui.js'
  });
  return {
    ui:sandbox.ConferenceMembersUI,
    calls:calls,
    elements:elements,
    setCurrent:function(value){current=value;},
    links:links,
    service:service
  };
}

async function run(){
  var env=environment();
  var html=env.ui.renderSection({
    localConference:{id:ids.localA},
    remoteConferenceId:ids.remoteA
  });
  assert.ok(html.indexOf('إدارة أعضاء المؤتمر')>=0);
  assert.strictEqual(env.calls.length,0);
  await env.ui.refresh();
  assert.deepStrictEqual(
    env.calls.map(function(call){return call.method;}),
    ['getCurrentAccess','listMembers']
  );
  assert.ok(
    env.elements.conference_members_content.innerHTML
      .indexOf('إزالة العضو')>=0
  );
  assert.ok(
    env.elements.conference_members_content.innerHTML
      .indexOf('Owner')>=0
  );
  env.ui.renderSection({
    localConference:{id:ids.localA},
    remoteConferenceId:ids.remoteA
  });
  assert.strictEqual(
    (await env.ui.refresh()).status,
    'already_refreshed'
  );
  assert.strictEqual(env.calls.length,2);
  await env.ui.refresh(true);
  assert.strictEqual(env.calls.length,4);

  await env.ui.lookup();
  assert.strictEqual(
    env.calls.filter(function(call){
      return call.method==='lookupUser';
    })[0].input.email,
    'manager@example.test'
  );
  assert.ok(
    env.elements.conference_members_content.innerHTML
      .indexOf('conference_member_role')>=0
  );
  await env.ui.addManager();
  assert.strictEqual(
    env.calls.filter(function(call){
      return call.method==='addMember';
    })[0].input.targetUserId,
    ids.manager
  );
  assert.strictEqual(
    env.calls.filter(function(call){
      return call.method==='listMembers';
    }).length,
    3
  );
  assert.ok(
    env.elements.conference_members_content.innerHTML
      .indexOf('تمت إضافة المدير')>=0
  );

  await env.ui.removeManager(ids.manager);
  assert.strictEqual(
    env.calls.filter(function(call){
      return call.method==='removeMember';
    })[0].input.targetUserId,
    ids.manager
  );
  assert.strictEqual(
    (await env.ui.changeRole(ids.owner,'viewer')).status,
    'invalid_input'
  );
  await env.ui.changeRole(ids.manager,'viewer');
  assert.strictEqual(
    env.calls.filter(function(call){
      return call.method==='changeRole';
    })[0].role,
    'viewer'
  );
  ['manager','viewer','accommodation_viewer',
    'transport_viewer'].forEach(function(role){
    assert.ok(
      env.elements.conference_members_content.innerHTML
        .indexOf('value="'+role+'"')>=0
    );
  });
  var selectableRoles=['manager','viewer','accommodation_viewer',
    'transport_viewer'];
  for(var roleIndex=0;roleIndex<selectableRoles.length;roleIndex++){
    await env.ui.lookup();
    env.elements.conference_member_role.value=selectableRoles[roleIndex];
    await env.ui.addMember();
    var latestAdd=env.calls.filter(function(call){
      return call.method==='addMember';
    }).slice(-1)[0];
    assert.strictEqual(latestAdd.role,selectableRoles[roleIndex]);
  }

  var manager=environment({
    service:{
      getCurrentAccess:function(){return Promise.resolve(access('manager'));},
      listMembers:function(){return Promise.resolve(list([]));}
    }
  });
  manager.ui.renderSection({
    localConference:{id:ids.localA},
    remoteConferenceId:ids.remoteA
  });
  await manager.ui.refresh();
  assert.strictEqual(
    manager.elements.conference_members_content.innerHTML
      .indexOf('إضافة عضو'),
    -1
  );

  var denied=environment({
    service:{
      getCurrentAccess:function(){
        return Promise.resolve({
          ok:false,status:'access_denied'
        });
      },
      listMembers:function(){
        throw new Error('list must not run');
      }
    }
  });
  denied.ui.renderSection({
    localConference:{id:ids.localA},
    remoteConferenceId:ids.remoteA
  });
  await denied.ui.refresh();
  assert.ok(
    denied.elements.conference_members_content.innerHTML
      .indexOf('لا يملك')>=0
  );

  var staleAccess=deferred();
  var switching=environment({
    service:{
      getCurrentAccess:function(){return staleAccess.promise;},
      listMembers:function(){
        throw new Error('stale list must not run');
      }
    }
  });
  switching.ui.renderSection({
    localConference:{id:ids.localA},
    remoteConferenceId:ids.remoteA
  });
  var oldRefresh=switching.ui.refresh();
  switching.setCurrent({id:ids.localB});
  switching.ui.renderSection({
    localConference:{id:ids.localB},
    remoteConferenceId:ids.remoteB
  });
  staleAccess.resolve(access('owner'));
  assert.strictEqual((await oldRefresh).status,'stale');
  assert.strictEqual(
    switching.elements.conference_members_content.innerHTML
      .indexOf(ids.remoteA),
    -1
  );

  var addDeferred=deferred();
  var doubleCalls=0;
  var doubleClick=environment({
    service:{
      getCurrentAccess:function(){return Promise.resolve(access('owner'));},
      listMembers:function(){
        return Promise.resolve(list([{
          userId:ids.owner,
          displayName:'Owner',
          role:'owner',
          isCurrentUser:true
        }]));
      },
      lookupUser:function(){
        return Promise.resolve({
          ok:true,status:'found',data:{
            targetUserId:ids.manager,
            displayName:'Manager'
          }
        });
      },
      addMember:function(){
        doubleCalls++;
        return addDeferred.promise;
      },
      addManager:function(){
        return this.addMember();
      }
    }
  });
  doubleClick.ui.renderSection({
    localConference:{id:ids.localA},
    remoteConferenceId:ids.remoteA
  });
  await doubleClick.ui.refresh();
  await doubleClick.ui.lookup();
  var first=doubleClick.ui.addManager();
  var second=doubleClick.ui.addManager();
  assert.strictEqual(first,second);
  await Promise.resolve();
  assert.strictEqual(doubleCalls,1);
  addDeferred.resolve({
    ok:false,status:'unknown_completion_state'
  });
  assert.strictEqual(
    (await first).status,
    'unknown_completion_state'
  );
  assert.ok(
    doubleClick.elements.conference_members_content.innerHTML
      .indexOf('قد تكون نُفذت')>=0
  );

  var lookupDeferred=deferred();
  var lookupCalls=0;
  var lookupDouble=environment({
    service:{
      getCurrentAccess:function(){return Promise.resolve(access('owner'));},
      listMembers:function(){return Promise.resolve(list([]));},
      lookupUser:function(){
        lookupCalls++;
        return lookupDeferred.promise;
      }
    }
  });
  lookupDouble.ui.renderSection({
    localConference:{id:ids.localA},
    remoteConferenceId:ids.remoteA
  });
  await lookupDouble.ui.refresh();
  var lookupOne=lookupDouble.ui.lookup();
  var lookupTwo=lookupDouble.ui.lookup();
  assert.strictEqual(lookupOne,lookupTwo);
  await Promise.resolve();
  assert.strictEqual(lookupCalls,1);
  lookupDeferred.resolve({
    ok:false,status:'not_found',data:null
  });
  await lookupOne;

  var autoRefreshAttempts=0;
  var autoRetry=environment({
    service:{
      getCurrentAccess:function(){
        autoRefreshAttempts++;
        if(autoRefreshAttempts===1){
          return Promise.resolve({
            ok:false,status:'network_error'
          });
        }
        return Promise.resolve(access('owner'));
      },
      listMembers:function(){
        return Promise.resolve(list([]));
      }
    }
  });
  autoRetry.ui.renderSection({
    localConference:{id:ids.localA},
    remoteConferenceId:ids.remoteA
  });
  assert.strictEqual(
    (await autoRetry.ui.refresh()).status,
    'network_error'
  );
  assert.strictEqual(
    (await autoRetry.ui.refresh()).status,
    'listed'
  );
  assert.strictEqual(autoRefreshAttempts,2);

  var mutationListCalls=0;
  var mutationRefreshFailure=environment({
    service:{
      getCurrentAccess:function(){
        return Promise.resolve(access('owner'));
      },
      listMembers:function(){
        mutationListCalls++;
        if(mutationListCalls===1){
          return Promise.resolve(list([{
            userId:ids.owner,
            displayName:'Owner',
            role:'owner',
            isCurrentUser:true
          }]));
        }
        return Promise.resolve({
          ok:false,status:'network_error'
        });
      },
      lookupUser:function(){
        return Promise.resolve({
          ok:true,status:'found',data:{
            targetUserId:ids.manager,
            displayName:'Manager'
          }
        });
      },
      addMember:function(){
        return Promise.resolve({
          ok:true,status:'added',data:{replayed:false}
        });
      },
      addManager:function(){
        return this.addMember();
      }
    }
  });
  mutationRefreshFailure.ui.renderSection({
    localConference:{id:ids.localA},
    remoteConferenceId:ids.remoteA
  });
  await mutationRefreshFailure.ui.refresh();
  await mutationRefreshFailure.ui.lookup();
  await mutationRefreshFailure.ui.addManager();
  var mutationFailureHtml=
    mutationRefreshFailure.elements
      .conference_members_content.innerHTML;
  assert.ok(mutationFailureHtml.indexOf('تمت إضافة المدير')>=0);
  assert.ok(
    mutationFailureHtml.indexOf(
      'قد تكون البيانات المعروضة قديمة'
    )>=0
  );
  assert.ok(mutationFailureHtml.indexOf('Owner')>=0);

  var publicApi=Object.keys(env.ui).sort();
  assert.deepStrictEqual(Array.from(publicApi),[
    'addManager',
    'addMember',
    'changeRole',
    'getAccessState',
    'lookup',
    'refresh',
    'removeManager',
    'removeMember',
    'renderSection',
    'resetForTests'
  ]);
  assert.strictEqual(source.indexOf('.rpc('),-1);
  [
    'SupabaseClientLayer',
    'ConferenceMembershipAttemptStore',
    'OfflineSyncQueue',
    'SupabaseSnapshotSync',
    'ConflictExecutor',
    'AutomaticSyncOrchestrator',
    'StorageRepository',
    'appData',
    'localStorage',
    'indexedDB'
  ].forEach(function(forbidden){
    assert.strictEqual(source.indexOf(forbidden),-1);
  });
  assert.ok(/localConferenceId/.test(source));
  assert.ok(/remoteConferenceId/.test(source));
  assert.ok(/requestId/.test(source));
  assert.ok(/function paint\(scope\)/.test(source));
  assert.strictEqual(/function paint\(\)\s*\{/.test(source),false);
  assert.ok(
    source.indexOf(
      'onclick="ConferenceMembersUI.refresh(true)"'
    )>=0
  );
  var attemptPosition=indexSource.indexOf(
    'js/sync/conference-membership-attempt-store.js'
  );
  var servicePosition=indexSource.indexOf(
    'js/sync/conference-members-service.js'
  );
  var uiPosition=indexSource.indexOf(
    'js/sync/conference-members-ui.js'
  );
  var scriptPosition=indexSource.indexOf('script.js?rev=');
  assert.ok(attemptPosition>=0);
  assert.ok(attemptPosition<servicePosition);
  assert.ok(servicePosition<uiPosition);
  assert.ok(uiPosition<scriptPosition);
  assert.ok(
    scriptSource.indexOf(
      'window.ConferenceMembersUI.renderSection'
    )>=0
  );
  assert.ok(
    scriptSource.indexOf(
      'window.ConferenceMembersUI.refresh()'
    )>=0
  );
  [
    'conference-membership-attempt-store.js',
    'conference-members-service.js',
    'conference-members-ui.js'
  ].forEach(function(asset){
    assert.ok(serviceWorkerSource.indexOf(asset)>=0);
  });
  // The revision value changes between releases; verify the cache contract
  // instead of coupling Conference Members to a historical release label.
  assert.ok(
    /const\s+CACHE_REVISION\s*=\s*IS_DEVELOPMENT\s*\?\s*['"]development-3-4-0-warehouse-current-store-context-v1['"]\s*:\s*['"]production-integrated-3-3-0-main-6d0c1e1-develop-80653ca-v1['"]\s*;/
      .test(serviceWorkerSource)
  );
  assert.ok(
    /const\s+CACHE_NAME\s*=\s*CACHE_PREFIX\s*\+\s*['"]v['"]\s*\+\s*APP_VERSION\s*\+\s*['"]-['"]\s*\+\s*CACHE_REVISION\s*;/
      .test(serviceWorkerSource)
  );
  assert.strictEqual(
    env.ui.resetForTests().status,
    'reset'
  );

  console.log('conference members UI tests: passed');
}

run().catch(function(error){
  console.error(error);
  process.exitCode=1;
});
