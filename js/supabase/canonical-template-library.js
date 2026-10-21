(function(global){
  'use strict';
  var records=Object.create(null),flight=null,epoch=0,hydrated=false;
  function copy(value){return value==null?value:JSON.parse(JSON.stringify(value));}
  function key(type,id){return String(type||'')+':'+String(id||'');}
  function invoke(operation,args){
    var session=global.PlatformDeviceSession;
    if(!session||typeof session.invokeModuleProtected!=='function'){
      return Promise.reject({code:'PLATFORM_DEVICE_SESSION_REQUIRED'});
    }
    return session.invokeModuleProtected('platform',operation,args||{});
  }
  function accept(response,expectedEpoch){
    if(expectedEpoch!==epoch)throw {code:'CANONICAL_TEMPLATE_SESSION_STALE'};
    if(!response||!Array.isArray(response.templates)){
      throw {code:'CANONICAL_TEMPLATE_LIST_INVALID'};
    }
    var next=Object.create(null);
    response.templates.forEach(function(item){
      var type=String(item&&item.templateType||''),id=String(item&&item.templateId||'');
      if((type!=='house'&&type!=='conference')||!id||!item.payload||
        typeof item.payload!=='object'||Array.isArray(item.payload)){
        throw {code:'CANONICAL_TEMPLATE_RECORD_INVALID'};
      }
      next[key(type,id)]={templateType:type,templateId:id,
        payload:copy(item.payload),revision:Number(item.revision||0),
        deletedAt:item.deletedAt||null,createdAt:item.createdAt||null,
        updatedAt:item.updatedAt||null};
    });
    if(expectedEpoch!==epoch)throw {code:'CANONICAL_TEMPLATE_SESSION_STALE'};
    records=next;
    hydrated=true;
    syncApplicationProjection();
    return list();
  }
  function list(type,includeDeleted){
    return Object.keys(records).map(function(id){return copy(records[id]);})
      .filter(function(item){
        return (!type||item.templateType===type)&&(includeDeleted===true||!item.deletedAt);
      });
  }
  function canonicalTrashItem(item){
    return {id:'canonical-template:'+item.templateType+':'+item.templateId,
      type:item.templateType==='conference'?'templates':'houseTemplates',
      deletedAt:item.deletedAt,payload:copy(item.payload)};
  }
  function syncApplicationProjection(){
    var data=global.appData;
    if(!data||typeof data!=='object')return;
    data.templates=list('conference').map(function(item){return copy(item.payload);});
    data.houseTemplates=list('house').map(function(item){return copy(item.payload);});
    data.trash=data.trash&&typeof data.trash==='object'?data.trash:{};
    data.trash.templates=list('conference',true).filter(function(item){return !!item.deletedAt;})
      .map(canonicalTrashItem);
    data.trash.houseTemplates=list('house',true).filter(function(item){return !!item.deletedAt;})
      .map(canonicalTrashItem);
  }
  function hydrate(){
    if(flight)return flight;
    var expectedEpoch=epoch;
    var request=invoke('list_library_templates',{}).then(function(response){
      return accept(response,expectedEpoch);
    });
    flight=request.then(function(value){if(flight===tracked)flight=null;return value;},
      function(error){if(flight===tracked)flight=null;throw error;});
    var tracked=flight;
    return tracked;
  }
  function mutate(type,id,action,payload){
    type=String(type||'');id=String(id||'');action=String(action||'');
    if(!hydrated){
      return hydrate().then(function(){return mutate(type,id,action,payload);});
    }
    var current=records[key(type,id)],operationId=global.crypto&&
      typeof global.crypto.randomUUID==='function'?global.crypto.randomUUID():'';
    if(!operationId)return Promise.reject({code:'CANONICAL_TEMPLATE_OPERATION_ID_REQUIRED'});
    return invoke('apply_library_template_content_operation',{
      p_operation_id:operationId,p_template_type:type,p_template_id:id,
      p_action:action,p_base_revision:current?current.revision:0,
      p_payload:action==='upsert'?copy(payload):null
    }).then(function(result){
      if(!result||result.status==='conflict')throw {code:'CANONICAL_TEMPLATE_REVISION_CONFLICT'};
      return hydrate();
    });
  }
  function clear(){
    epoch++;records=Object.create(null);flight=null;hydrated=false;
    syncApplicationProjection();
  }
  if(global.addEventListener)global.addEventListener('platform-session-reset',clear);
  global.CanonicalTemplateLibrary=Object.freeze({
    hydrate:hydrate,list:list,mutate:mutate,clear:clear,
    isHydrated:function(){return hydrated;}
  });
})(window);
