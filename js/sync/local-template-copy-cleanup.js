(function(global){
  'use strict';
  var TARGET=Object.freeze({
    memberUserId:'dae5cf37-b6fc-49cb-a57b-09e06c2a635d',
    templateId:'5c96c45f-ae22-4993-a3e7-d97e0b2598cf',
    templateName:'بيت ابونا سمعان (نسخة)',
    originalTemplateId:'8bd4bc0b-6104-4da0-aef0-9688a0459a79'
  });
  var STORE_KEYS=Object.freeze(['libraryTemplateContentOperations',
    'organizationTemplateOperations','organizationTemplateAccessOperations']);
  var running=null;
  function copy(value){return JSON.parse(JSON.stringify(value));}
  function result(ok,status,data,error){return {ok:ok===true,status:String(status||''),data:data||null,error:error||null};}
  function namespace(){return global.BrowserStorageNamespace||{environment:'production'};}
  function dependencies(options){options=options||{};return {data:options.appData||global.appData,db:options.db||global.AppIndexedDB,repository:options.repository||global.StorageRepository,storage:options.storage||global.localStorage,auth:options.auth||global.SupabaseAuth};}
  function target(data){return (Array.isArray(data&&data.houseTemplates)?data.houseTemplates:[]).find(function(item){return String(item&&item.id||'')===TARGET.templateId;})||null;}
  function nullish(value){return value===null||value===undefined;}
  function exactTemplate(item){var access=Array.isArray(item&&item.accessibleOrganizationIds)?item.accessibleOrganizationIds:[];return !!item&&String(item.name||'')===TARGET.templateName&&nullish(item.ownerUserId)&&nullish(item.cloudOwnerUserId)&&nullish(item.organizationId)&&access.length===0&&nullish(item.cloudSyncStatus)&&nullish(item.revision)&&nullish(item.cloudRevision);}
  function context(d){var state=d.auth&&d.auth.getState&&d.auth.getState();return !!state&&state.authenticated===true&&state.user&&String(state.user.id)===TARGET.memberUserId;}
  function readOperations(d){if(!d.db||typeof d.db.getAllRecords!=='function')return Promise.reject(new Error('INDEXEDDB_UNAVAILABLE'));var stores=d.db.stores||{};return Promise.all(STORE_KEYS.map(function(key){if(!stores[key])throw new Error('INDEXEDDB_STORE_UNAVAILABLE');return Promise.resolve(d.db.getAllRecords(stores[key]));})).then(function(groups){return groups.reduce(function(count,rows){return count+(Array.isArray(rows)?rows:[]).filter(function(row){return String(row&&row.templateId||'')===TARGET.templateId;}).length;},0);});}
  function inspectLocal(options){if(namespace().environment==='development')return result(false,'development_environment_blocked');var d=dependencies(options);if(!context(d))return result(false,'member_identity_mismatch');var item=target(d.data);if(!item)return result(true,'already_clean',{templateId:TARGET.templateId});if(!exactTemplate(item))return result(false,'template_identity_mismatch');if(!(d.data.houseTemplates||[]).some(function(row){return String(row&&row.id||'')===TARGET.originalTemplateId;}))return result(false,'original_template_missing');return result(true,'local_copy_identity_confirmed',{templateId:TARGET.templateId});}
  function preflight(options){var checked=inspectLocal(options);if(!checked.ok||checked.status==='already_clean')return Promise.resolve(checked);var d=dependencies(options);return readOperations(d).then(function(count){return count===0?result(true,'local_copy_confirmed',{templateId:TARGET.templateId,relatedOperations:0}):result(false,'related_operations_present',{relatedOperations:count});}).catch(function(error){return result(false,'inspection_failed',null,{code:String(error&&error.message||'INSPECTION_FAILED')});});}
  function cleanup(options){if(running)return running;running=preflight(options).then(function(checked){if(!checked.ok||checked.status==='already_clean')return checked;var d=dependencies(options),next=copy(d.data);next.houseTemplates=next.houseTemplates.filter(function(item){return String(item&&item.id||'')!==TARGET.templateId;});if(!next.houseTemplates.some(function(item){return String(item&&item.id||'')===TARGET.originalTemplateId;})||next.houseTemplates.length!==(d.data.houseTemplates||[]).length-1)throw new Error('TARGETED_REMOVAL_FAILED');if(!d.repository||typeof d.repository.saveAppSnapshot!=='function')throw new Error('LOCAL_PERSISTENCE_UNAVAILABLE');return d.repository.saveAppSnapshot(next,{skipSyncQueue:true,skipTemplateSync:true}).then(function(){global.appData=next;d.data=next;return result(true,'cleanup_completed',{templateId:TARGET.templateId,cloudMutationPerformed:false});});}).catch(function(error){return result(false,'cleanup_failed',null,{code:String(error&&error.message||'LOCAL_CLEANUP_FAILED')});}).finally(function(){running=null;});return running;}
  global.LocalTemplateCopyCleanup=Object.freeze({inspectLocal:inspectLocal,preflight:preflight,cleanup:cleanup,targetTemplateId:TARGET.templateId,originalTemplateId:TARGET.originalTemplateId});
})(window);
