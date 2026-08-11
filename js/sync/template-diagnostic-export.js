(function(global){
  'use strict';

  var STORE_KEYS=Object.freeze([
    'libraryTemplateContentOperations',
    'organizationTemplateOperations',
    'organizationTemplateAccessOperations'
  ]);

  function text(value){return value==null?null:String(value);}
  function number(value){
    return value===null||value===undefined||value===''
      ?null:Number.isInteger(Number(value))?Number(value):null;
  }
  function list(value){
    return Array.isArray(value)?value.map(String):[];
  }
  function templateRow(template){
    return {
      id:text(template&&template.id),
      name:text(template&&template.name),
      ownerUserId:text(template&&(template.ownerUserId||template.cloudOwnerUserId)),
      organizationId:text(template&&template.organizationId),
      accessibleOrganizationIds:list(template&&template.accessibleOrganizationIds),
      cloudSyncStatus:text(template&&template.cloudSyncStatus),
      revision:number(template&&(template.revision!==undefined
        ?template.revision:template.cloudRevision)),
      createdAt:text(template&&template.createdAt),
      updatedAt:text(template&&(template.updatedAt||template.cloudUpdatedAt))
    };
  }
  function operationRow(row){
    var result=row&&row.result&&typeof row.result==='object'?row.result:{};
    return {
      operationId:text(row&&row.operationId),
      templateId:text(row&&row.templateId),
      status:text(row&&row.status),
      lastErrorCode:text(row&&row.lastErrorCode),
      targetOrganizationId:text(row&&(
        row.targetOrganizationId||row.organizationId
      )),
      expectedRevision:number(row&&(
        row.expectedRevision!==undefined
          ?row.expectedRevision:row.baseRevision
      )),
      resultingRevision:number(row&&(
        row.resultingRevision!==undefined
          ?row.resultingRevision:result.revision
      )),
      createdAt:text(row&&row.createdAt),
      updatedAt:text(row&&row.updatedAt)
    };
  }
  function memberships(options){
    var sync=options.organizationTemplateSync||global.OrganizationTemplateSync;
    var state=sync&&typeof sync.getAdoptionState==='function'
      ?sync.getAdoptionState():null;
    return (state&&Array.isArray(state.organizations)
      ?state.organizations:[]).map(function(item){
      return {
        organizationId:text(item&&item.organizationId),
        role:text(item&&item.role)
      };
    });
  }
  function context(options){
    var auth=options.auth||global.SupabaseAuth;
    var authState=auth&&typeof auth.getState==='function'
      ?auth.getState():null;
    var identity=options.deviceIdentity||global.SupabaseDeviceIdentity;
    var device=identity&&typeof identity.getCurrent==='function'
      ?identity.getCurrent():null;
    return {
      currentUserId:text(authState&&authState.user&&authState.user.id),
      organizationMemberships:memberships(options),
      currentDeviceId:text(device&&device.id),
      timestamp:new Date().toISOString()
    };
  }
  function stores(repository){
    var names=repository&&repository.stores||{};
    return STORE_KEYS.map(function(key){
      var name=names[key];
      if(!name||typeof repository.getAllRecords!=='function'){
        return Promise.reject(new Error('TEMPLATE_DIAGNOSTIC_STORE_UNAVAILABLE'));
      }
      return Promise.resolve(repository.getAllRecords(name)).then(function(rows){
        return {
          name:name,
          rows:(Array.isArray(rows)?rows:[]).map(operationRow)
        };
      });
    });
  }
  function createBundle(options){
    options=options||{};
    var repository=options.indexedDb||global.AppIndexedDB;
    var data=options.appData||global.appData||{};
    return Promise.all(stores(repository)).then(function(reads){
      var operationStores={};
      reads.forEach(function(read){operationStores[read.name]=read.rows;});
      return {
        context:context(options),
        houseTemplates:(Array.isArray(data.houseTemplates)
          ?data.houseTemplates:[]).map(templateRow),
        operationStores:operationStores
      };
    });
  }
  function fileName(bundle){
    return 'template-diagnostic_'+String(
      bundle&&bundle.context&&bundle.context.timestamp||''
    )
      .replace(/[:.]/g,'-')+'.json';
  }
  function download(bundle,options){
    options=options||{};
    var documentApi=options.document||global.document;
    var urlApi=options.URL||global.URL;
    if(!documentApi||!urlApi||typeof global.Blob!=='function'){
      throw new Error('DOWNLOAD_API_UNAVAILABLE');
    }
    var blob=new global.Blob([JSON.stringify(bundle,null,2)],{
      type:'application/json'
    });
    var url=urlApi.createObjectURL(blob);
    var anchor=documentApi.createElement('a');
    anchor.href=url;
    anchor.download=fileName(bundle);
    anchor.rel='noopener';
    anchor.click();
    urlApi.revokeObjectURL(url);
    return anchor.download;
  }
  function exportBundle(options){
    return createBundle(options).then(function(bundle){
      return {bundle:bundle,fileName:download(bundle,options)};
    });
  }

  global.TemplateDiagnosticExport=Object.freeze({
    createBundle:createBundle,
    exportBundle:exportBundle,
    download:download,
    fileName:fileName
  });
})(window);
