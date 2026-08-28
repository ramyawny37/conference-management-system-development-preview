(function(global){
  'use strict';

  var ORGANIZATION_ID='8c2562cc-aa77-4404-8c58-fe36a51280f5';
  var TARGETS=Object.freeze({
    '5f96dee5-c796-4e75-9a1d-1b1bd3659112':Object.freeze({
      name:'Smoke House',revision:12
    }),
    '835cb97d-50cd-4bba-8285-1d81dfa8608e':Object.freeze({
      name:'اطسا',revision:1
    }),
    'fcee488a-82d7-4e70-b296-fbace0e558a9':Object.freeze({
      name:'التكويني',revision:1
    })
  });
  var OPERATION_STORES=Object.freeze([
    'libraryTemplateContentOperations',
    'organizationTemplateOperations',
    'organizationTemplateAccessOperations'
  ]);
  var running=null;

  function copy(value){return JSON.parse(JSON.stringify(value));}
  function result(ok,status,data,error){
    return {ok:ok===true,status:String(status||''),data:data||null,error:error||null};
  }
  function namespace(){
    return global.BrowserStorageNamespace||{environment:'production'};
  }
  function uuid(){
    if(global.crypto&&typeof global.crypto.randomUUID==='function'){
      return global.crypto.randomUUID();
    }
    throw new Error('SECURE_UUID_UNAVAILABLE');
  }
  function dependencies(options){
    options=options||{};
    var client=null;
    try{
      client=options.client||global.SupabaseClientLayer&&
        global.SupabaseClientLayer.getClient&&
        global.SupabaseClientLayer.getClient();
    }catch(error){client=null;}
    return {
      client:client,
      auth:options.auth||global.SupabaseAuth,
      device:options.device||global.SupabaseDeviceIdentity,
      db:options.db||global.AppIndexedDB,
      repository:options.repository||global.StorageRepository,
      templateSync:options.templateSync||global.OrganizationTemplateSync,
      storage:options.storage||global.localStorage,
      data:options.appData||global.appData
    };
  }
  function currentContext(d){
    var auth=d.auth&&d.auth.getState&&d.auth.getState();
    var device=d.device&&d.device.getCurrent&&d.device.getCurrent();
    if(!auth||auth.authenticated!==true||!auth.user||!auth.user.id){
      return result(false,'authentication_required');
    }
    if(!device||!device.id)return result(false,'approved_device_required');
    if(!d.client||typeof d.client.rpc!=='function'){
      return result(false,'cloud_client_unavailable');
    }
    return result(true,'context_ready',{
      userId:String(auth.user.id),deviceId:String(device.id)
    });
  }
  function localCandidates(data){
    var houses=Array.isArray(data&&data.houseTemplates)?data.houseTemplates:[];
    return houses.filter(function(item){
      return !!TARGETS[String(item&&item.id||'')];
    });
  }
  function inspectLocal(options){
    var d=dependencies(options);
    if(namespace().environment==='development'){
      return result(false,'development_environment_blocked');
    }
    if(!d.data||!Array.isArray(d.data.houseTemplates)){
      return result(false,'app_data_invalid');
    }
    if(Array.isArray(d.data.conferences)&&d.data.conferences.length){
      return result(false,'conference_references_not_empty');
    }
    var candidates=localCandidates(d.data);
    for(var index=0;index<candidates.length;index++){
      var item=candidates[index];
      var expected=TARGETS[String(item.id)];
      if(String(item.name||'')!==expected.name||item.organizationId||
        item.cloudSyncStatus!=='synced'||
        Number(item.cloudRevision)!==expected.revision||
        !Array.isArray(item.accessibleOrganizationIds)||
        item.accessibleOrganizationIds.indexOf(ORGANIZATION_ID)<0){
        return result(false,'local_template_mismatch',{templateId:String(item.id)});
      }
    }
    return result(true,candidates.length?'local_candidates_confirmed':'already_clean',{
      templates:candidates.map(function(item){
        return {id:String(item.id),name:String(item.name),
          revision:Number(item.cloudRevision)};
      })
    });
  }
  function readCloudInventory(d,context){
    return d.client.rpc('list_shared_organization_templates',{
      p_actor_device_id:context.deviceId
    }).then(function(response){
      if(response&&response.error)throw response.error;
      var value=response&&response.data||{};
      if(value.status!=='success'||!Array.isArray(value.templates)){
        throw new Error('MALFORMED_TEMPLATE_LIST');
      }
      return value.templates;
    });
  }
  function preflight(options){
    var local=inspectLocal(options);
    if(!local.ok||local.status==='already_clean')return Promise.resolve(local);
    var d=dependencies(options);
    var context=currentContext(d);
    if(!context.ok)return Promise.resolve(context);
    return readCloudInventory(d,context.data).then(function(rows){
      var checked=[];
      for(var index=0;index<local.data.templates.length;index++){
        var item=local.data.templates[index];
        var row=rows.find(function(value){
          return value&&value.templateType==='house'&&
            String(value.templateId||'')===item.id;
        });
        var cloudDeleted=!!(row&&row.deletedAt);
        if(!row||String(row.ownerUserId||'')!==context.data.userId||
          !Array.isArray(row.accessibleOrganizationIds)||
          row.accessibleOrganizationIds.map(String).indexOf(ORGANIZATION_ID)<0||
          (!cloudDeleted&&Number(row.revision)!==item.revision)||
          (cloudDeleted&&Number(row.revision)<item.revision)){
          return result(false,'cloud_template_mismatch',{templateId:item.id});
        }
        checked.push(Object.assign({},item,{cloudDeleted:cloudDeleted,
          cloudRevision:Number(row.revision)}));
      }
      return result(true,'cleanup_confirmed',{
        templates:checked,userId:context.data.userId,
        deviceId:context.data.deviceId
      });
    }).catch(function(error){
      return result(false,'cloud_preflight_failed',null,{
        code:String(error&&error.code||error&&error.message||'CLOUD_PREFLIGHT_FAILED')
      });
    });
  }
  function deleteCloud(d,context,item){
    if(item.cloudDeleted)return Promise.resolve({
      status:'unchanged',revision:item.cloudRevision
    });
    return d.client.rpc('apply_library_template_content_operation',{
      p_actor_device_id:context.deviceId,
      p_operation_id:uuid(),
      p_template_type:'house',
      p_template_id:item.id,
      p_action:'delete',
      p_base_revision:item.revision,
      p_payload:null
    }).then(function(response){
      if(response&&response.error)throw response.error;
      var value=response&&response.data||{};
      if(['deleted','unchanged'].indexOf(value.status)<0){
        throw new Error(value.status==='conflict'
          ?'CLOUD_TEMPLATE_REVISION_CONFLICT':'MALFORMED_DELETE_RESULT');
      }
      return value;
    });
  }
  function operationStoreNames(d){
    var names=d.db&&d.db.stores||{};
    return OPERATION_STORES.map(function(alias){return names[alias];})
      .filter(Boolean);
  }
  function cleanOperationMetadata(d,templateId){
    if(!d.db||typeof d.db.getAllRecords!=='function'||
      typeof d.db.deleteRecord!=='function'){
      return Promise.reject(new Error('INDEXEDDB_UNAVAILABLE'));
    }
    var stores=operationStoreNames(d);
    return Promise.all(stores.map(function(storeName){
      return d.db.getAllRecords(storeName).then(function(rows){
        var matches=(Array.isArray(rows)?rows:[]).filter(function(row){
          return row&&row.templateType==='house'&&
            String(row.templateId||'')===templateId;
        });
        return Promise.all(matches.map(function(row){
          return d.db.deleteRecord(storeName,row.operationId);
        })).then(function(){return {store:storeName,count:matches.length};});
      });
    }));
  }
  function removeLocal(d,item,cloudResult,options){
    var next=copy(d.data);
    next.houseTemplates=(next.houseTemplates||[]).filter(function(template){
      return String(template&&template.id||'')!==item.id;
    });
    return cleanOperationMetadata(d,item.id).then(function(metadata){
      return d.repository.saveAppSnapshot(next,{
        skipSyncQueue:true,skipTemplateSync:true
      }).then(function(){
        global.appData=next;
        d.data=next;
        if(d.templateSync&&typeof d.templateSync.forgetDeletedTemplates==='function'){
          d.templateSync.forgetDeletedTemplates([{
            templateType:'house',templateId:item.id,
            revision:Number(cloudResult.revision||item.revision)
          }]);
        }
        return {templateId:item.id,metadata:metadata};
      });
    });
  }
  function cleanup(options){
    if(running)return running;
    running=preflight(options).then(function(checked){
      if(!checked.ok||checked.status==='already_clean')return checked;
      var d=dependencies(options);
      var completed=[];
      var chain=Promise.resolve();
      checked.data.templates.forEach(function(item){
        chain=chain.then(function(){
          return deleteCloud(d,checked.data,item).then(function(cloudResult){
            return removeLocal(d,item,cloudResult,options).then(function(local){
              completed.push({id:item.id,name:item.name,
                cloudStatus:cloudResult.status,metadata:local.metadata});
            });
          });
        });
      });
      return chain.then(function(){
        return result(true,'cleanup_completed',{templates:completed});
      });
    }).catch(function(error){
      return result(false,'cleanup_failed',null,{
        code:String(error&&error.code||error&&error.message||'CLEANUP_FAILED')
      });
    }).finally(function(){running=null;});
    return running;
  }

  global.TestHouseTemplateCleanup=Object.freeze({
    inspectLocal:inspectLocal,preflight:preflight,cleanup:cleanup,
    allowlistedTemplateIds:Object.keys(TARGETS),organizationId:ORGANIZATION_ID
  });
})(window);
