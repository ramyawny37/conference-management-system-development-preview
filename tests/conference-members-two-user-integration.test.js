'use strict';

var assert=require('assert');
var fs=require('fs');
var path=require('path');
var vm=require('vm');

var attemptStoreSource=fs.readFileSync(path.resolve(
  __dirname,'../js/sync/conference-membership-attempt-store.js'
),'utf8');
var serviceSource=fs.readFileSync(path.resolve(
  __dirname,'../js/sync/conference-members-service.js'
),'utf8');
var uiSource=fs.readFileSync(path.resolve(
  __dirname,'../js/sync/conference-members-ui.js'
),'utf8');

var ids={
  owner:'11111111-1111-4111-8111-111111111111',
  manager:'22222222-2222-4222-8222-222222222222',
  conferenceA:'33333333-3333-4333-8333-333333333333',
  conferenceB:'44444444-4444-4444-8444-444444444444',
  localA:'local-conference-a',
  localB:'local-conference-b'
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

function fakeIndexedDb(){
  var stores=Object.create(null);

  function requestFor(action){
    var request={result:null,error:null};
    setTimeout(function(){
      try{
        request.result=action();
        if(request.onsuccess)request.onsuccess();
      }catch(error){
        request.error=error;
        if(request.onerror)request.onerror();
      }
    },0);
    return request;
  }

  return {
    open:function(){
      var request={result:null,error:null};
      setTimeout(function(){
        var db={
          objectStoreNames:{
            contains:function(name){
              return Object.prototype.hasOwnProperty.call(stores,name);
            }
          },
          createObjectStore:function(name){
            if(!stores[name])stores[name]=Object.create(null);
          },
          transaction:function(name){
            if(!stores[name])stores[name]=Object.create(null);
            return {
              objectStore:function(){
                return {
                  get:function(key){
                    return requestFor(function(){
                      return stores[name][key]||null;
                    });
                  },
                  put:function(value){
                    return requestFor(function(){
                      stores[name][value.attemptKey]=
                        JSON.parse(JSON.stringify(value));
                      return value.attemptKey;
                    });
                  },
                  delete:function(key){
                    return requestFor(function(){
                      delete stores[name][key];
                    });
                  }
                };
              }
            };
          },
          close:function(){}
        };
        request.result=db;
        if(request.onupgradeneeded){
          request.onupgradeneeded({target:{result:db}});
        }
        if(request.onsuccess)request.onsuccess();
      },0);
      return request;
    }
  };
}

function membershipBackend(){
  var members=Object.create(null);
  var operations=Object.create(null);
  var profiles=Object.create(null);
  var calls=[];
  var failNextList=Object.create(null);
  var deferredNextList=Object.create(null);

  members[ids.conferenceA]=Object.create(null);
  members[ids.conferenceA][ids.owner]='owner';
  members[ids.conferenceB]=Object.create(null);
  members[ids.conferenceB][ids.owner]='owner';
  profiles[ids.owner]={
    email:'owner@example.test',
    displayName:'Owner A'
  };
  profiles[ids.manager]={
    email:'manager@example.test',
    displayName:'Manager B'
  };

  function conferenceId(args){
    return String(args&&args.p_conference_id||'');
  }

  function access(actor,remoteConferenceId){
    return members[remoteConferenceId]&&
      members[remoteConferenceId][actor]||null;
  }

  function response(data){
    return Promise.resolve({data:data,error:null});
  }

  function rpc(actor,name,args){
    calls.push({actor:actor,name:name,args:Object.assign({},args)});
    var remoteConferenceId=conferenceId(args);
    var actorRole=access(actor,remoteConferenceId);

    if(name==='get_my_conference_access'){
      if(!actorRole){
        return response({
          success:false,
          status:'access_denied',
          conferenceId:remoteConferenceId
        });
      }
      return response({
        success:true,
        status:'available',
        conferenceId:remoteConferenceId,
        userId:actor,
        role:actorRole,
        canManageMembers:actorRole==='owner',
        canSync:actorRole==='owner'||actorRole==='manager',
        canResolveConflicts:actorRole==='owner'||actorRole==='manager',
        canAcquireLock:actorRole==='owner'||actorRole==='manager'
      });
    }

    if(name==='list_conference_members'){
      if(!actorRole){
        return Promise.resolve({
          data:null,
          error:{code:'42501',message:'conference membership required'}
        });
      }
      if(failNextList[remoteConferenceId]){
        delete failNextList[remoteConferenceId];
        return Promise.resolve({
          data:null,
          error:{message:'network failed'}
        });
      }
      var pending=deferredNextList[remoteConferenceId];
      if(pending){
        delete deferredNextList[remoteConferenceId];
        return pending.promise.then(function(){
          return listResponse(remoteConferenceId,actor);
        });
      }
      return Promise.resolve(listResponse(remoteConferenceId,actor));
    }

    if(name==='lookup_conference_user_by_email'){
      if(actorRole!=='owner'){
        return Promise.resolve({
          data:null,
          error:{code:'42501',message:'conference owner access required'}
        });
      }
      var email=String(args.p_email||'').trim().toLowerCase();
      var targetUserId=Object.keys(profiles).filter(function(userId){
        return profiles[userId].email===email;
      })[0]||null;
      if(!targetUserId){
        return response({
          success:false,
          status:'not_found',
          conferenceId:remoteConferenceId
        });
      }
      return response({
        success:true,
        status:'found',
        conferenceId:remoteConferenceId,
        targetUserId:targetUserId,
        displayName:profiles[targetUserId].displayName
      });
    }

    if(name==='manage_conference_member'){
      if(actorRole!=='owner'){
        return Promise.resolve({
          data:null,
          error:{code:'42501',message:'conference owner access required'}
        });
      }
      return membershipMutation(
        actor,name,args,remoteConferenceId
      );
    }

    return Promise.resolve({
      data:null,error:{code:'RPC_NOT_FOUND',message:'RPC not found'}
    });
  }

  function listResponse(remoteConferenceId,actor){
    var rows=Object.keys(members[remoteConferenceId]||{})
      .map(function(userId){
        return {
          user_id:userId,
          display_name:profiles[userId]&&
            profiles[userId].displayName||null,
          role:members[remoteConferenceId][userId],
          created_at:'2026-07-29T00:00:00.000Z',
          is_current_user:userId===actor
        };
      })
      .sort(function(left,right){
        return left.role==='owner'?-1:right.role==='owner'?1:0;
      });
    return {data:rows,error:null};
  }

  function membershipMutation(actor,name,args,remoteConferenceId){
    var operationId=String(args.p_operation_id||'');
    var targetUserId=String(args.p_target_user_id||'');
    var action=String(args.p_action||'');
    var requestedRole=args.p_requested_role==null
      ?null:String(args.p_requested_role);
    var existing=operations[operationId];
    if(existing){
      if(existing.actor!==actor||
        existing.remoteConferenceId!==remoteConferenceId||
        existing.targetUserId!==targetUserId||
        existing.action!==action||
        existing.requestedRole!==requestedRole){
        return Promise.resolve({
          data:null,
          error:{message:'operation id belongs to another operation'}
        });
      }
      return response(Object.assign({},existing.result,{
        replayed:true
      }));
    }
    var status;
    var role;
    if(action==='add'){
      status=members[remoteConferenceId][targetUserId]==='manager'
        ?'unchanged':'added';
      members[remoteConferenceId][targetUserId]='manager';
      role='manager';
    }else{
      status=members[remoteConferenceId][targetUserId]==='manager'
        ?'removed':'already_removed';
      delete members[remoteConferenceId][targetUserId];
      role=null;
    }
    var result={
      success:true,
      status:status,
      conferenceId:remoteConferenceId,
      targetUserId:targetUserId,
      role:role,
      operationId:operationId
    };
    operations[operationId]={
      actor:actor,
      remoteConferenceId:remoteConferenceId,
      targetUserId:targetUserId,
      action:action,
      requestedRole:requestedRole,
      result:result
    };
    return response(result);
  }

  return {
    rpc:rpc,
    calls:calls,
    members:members,
    failNextList:function(remoteConferenceId){
      failNextList[remoteConferenceId]=true;
    },
    deferNextList:function(remoteConferenceId){
      var pending=deferred();
      deferredNextList[remoteConferenceId]=pending;
      return pending;
    }
  };
}

function userRuntime(actorUserId,backend){
  var session={user:{id:actorUserId}};
  var current={id:ids.localA};
  var links=Object.create(null);
  links[ids.localA]={remoteConferenceId:ids.conferenceA};
  links[ids.localB]={remoteConferenceId:ids.conferenceB};
  var elements={
    conference_members_content:{innerHTML:''},
    conference_member_lookup_email:{value:'manager@example.test'}
  };
  var uuidCounter=0;
  var sandbox={
    window:null,
    Promise:Promise,
    JSON:JSON,
    Object:Object,
    String:String,
    Number:Number,
    Math:Math,
    Array:Array,
    Date:Date,
    Uint8Array:Uint8Array,
    setTimeout:setTimeout,
    clearTimeout:clearTimeout,
    structuredClone:global.structuredClone,
    indexedDB:fakeIndexedDb(),
    crypto:{
      randomUUID:function(){
        uuidCounter++;
        return 'aaaaaaaa-aaaa-4aaa-8aaa-'+
          String(uuidCounter).padStart(12,'0');
      }
    },
    SupabaseClientLayer:{
      getClient:function(){
        return {
          rpc:function(name,args){
            return backend.rpc(actorUserId,name,args);
          }
        };
      }
    },
    SupabaseAuth:{
      getSession:function(){return session;}
    },
    getCurrentConference:function(){return current;},
    ConferenceLinkStore:{
      get:function(localConferenceId){
        return links[localConferenceId]||null;
      }
    },
    document:{
      getElementById:function(id){return elements[id]||null;}
    },
    confirm:function(){return true;},
    console:console
  };
  sandbox.window=sandbox;
  vm.runInNewContext(attemptStoreSource,sandbox,{
    filename:'conference-membership-attempt-store.js'
  });
  vm.runInNewContext(serviceSource,sandbox,{
    filename:'conference-members-service.js'
  });
  vm.runInNewContext(uiSource,sandbox,{
    filename:'conference-members-ui.js'
  });

  function render(){
    return sandbox.ConferenceMembersUI.renderSection({
      localConference:current,
      remoteConferenceId:links[current.id]&&
        links[current.id].remoteConferenceId||''
    });
  }

  return {
    ui:sandbox.ConferenceMembersUI,
    elements:elements,
    render:render,
    setCurrent:function(localConferenceId){
      current={id:localConferenceId};
      render();
    },
    expireSession:function(){session=null;},
    restoreSession:function(){session={user:{id:actorUserId}};}
  };
}

function html(runtime){
  return runtime.elements.conference_members_content.innerHTML;
}

async function lookupAndAdd(runtime){
  runtime.elements.conference_member_lookup_email.value=
    'manager@example.test';
  assert.strictEqual((await runtime.ui.lookup()).status,'found');
  return runtime.ui.addManager();
}

async function run(){
  var backend=membershipBackend();
  var owner=userRuntime(ids.owner,backend);
  var manager=userRuntime(ids.manager,backend);

  owner.render();
  assert.strictEqual((await owner.ui.refresh()).status,'listed');
  assert.strictEqual((await lookupAndAdd(owner)).status,'added');
  assert.strictEqual(
    backend.members[ids.conferenceA][ids.manager],
    'manager'
  );
  assert.ok(html(owner).indexOf('Manager B')>=0);
  assert.strictEqual(
    Object.keys(backend.members[ids.conferenceA]).length,
    2
  );

  manager.render();
  assert.strictEqual((await manager.ui.refresh()).status,'listed');
  assert.ok(html(manager).indexOf('Manager B')>=0);
  assert.strictEqual(html(manager).indexOf('إضافة عضو'),-1);
  assert.strictEqual(html(manager).indexOf('إزالة العضو'),-1);
  var mutationCallsBefore=backend.calls.filter(function(call){
    return call.name==='manage_conference_member';
  }).length;
  assert.strictEqual(
    (await manager.ui.addManager()).status,
    'invalid_input'
  );
  assert.strictEqual(
    (await manager.ui.removeManager(ids.owner)).status,
    'invalid_input'
  );
  assert.strictEqual(
    backend.calls.filter(function(call){
      return call.name==='manage_conference_member';
    }).length,
    mutationCallsBefore
  );

  assert.strictEqual((await lookupAndAdd(owner)).status,'already_manager');
  assert.strictEqual(
    Object.keys(backend.members[ids.conferenceA]).length,
    2
  );
  assert.ok(html(owner).indexOf('المستخدم مدير بالفعل')>=0);

  assert.strictEqual(
    (await owner.ui.removeManager(ids.manager)).status,
    'removed'
  );
  assert.strictEqual(
    (await owner.ui.removeManager(ids.manager)).status,
    'already_removed'
  );
  assert.strictEqual(
    Object.prototype.hasOwnProperty.call(
      backend.members[ids.conferenceA],
      ids.manager
    ),
    false
  );
  assert.ok(html(owner).indexOf('المستخدم لم يعد مديرًا')>=0);

  manager.render();
  assert.strictEqual(
    (await manager.ui.refresh(true)).status,
    'access_denied'
  );
  assert.ok(html(manager).indexOf('لا يملك هذا الحساب')>=0);

  backend.failNextList(ids.conferenceA);
  assert.strictEqual((await lookupAndAdd(owner)).status,'added');
  assert.ok(html(owner).indexOf('تمت إضافة المدير')>=0);
  assert.ok(
    html(owner).indexOf('قد تكون البيانات المعروضة قديمة')>=0
  );
  assert.strictEqual(
    (await owner.ui.refresh(true)).status,
    'listed'
  );
  assert.ok(html(owner).indexOf('Manager B')>=0);
  assert.strictEqual(
    html(owner).indexOf('قد تكون البيانات المعروضة قديمة'),
    -1
  );

  var oldConferenceList=backend.deferNextList(ids.conferenceA);
  var oldRequest=owner.ui.refresh(true);
  await new Promise(function(resolve){setTimeout(resolve,0);});
  owner.setCurrent(ids.localB);
  assert.strictEqual((await owner.ui.refresh()).status,'listed');
  assert.strictEqual(html(owner).indexOf('Manager B'),-1);
  oldConferenceList.resolve();
  assert.strictEqual((await oldRequest).status,'stale');
  assert.strictEqual(html(owner).indexOf('Manager B'),-1);

  owner.expireSession();
  assert.strictEqual(
    (await owner.ui.refresh(true)).status,
    'auth_required'
  );
  assert.ok(html(owner).indexOf('انتهت جلسة تسجيل الدخول')>=0);
  owner.restoreSession();
  assert.strictEqual(
    (await owner.ui.refresh(true)).status,
    'listed'
  );
  assert.ok(html(owner).indexOf('صلاحيتك')>=0);

  assert.strictEqual(
    uiSource.indexOf('.rpc('),
    -1
  );
  assert.strictEqual(
    backend.calls.some(function(call){
      return call.actor===ids.manager&&
        call.name==='manage_conference_member';
    }),
    false
  );

  console.log(
    'conference members two-user integration tests: passed'
  );
}

run().catch(function(error){
  console.error(error);
  process.exitCode=1;
});
