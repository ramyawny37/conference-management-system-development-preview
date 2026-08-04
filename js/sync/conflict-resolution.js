(function(global){
  'use strict';

  var STRATEGIES=Object.freeze(['keep_local','keep_server','manual']);
  var PUBLIC_STATUSES=Object.freeze({
    pending:'open',
    resolved:'resolved',
    ignored:'discarded'
  });
  var state={
    lastReadAt:null,
    lastError:null
  };

  function result(ok,status,data,error){
    return {
      ok:ok,
      status:status,
      data:data===undefined?null:data,
      error:error||null
    };
  }

  function safeError(code,message){
    return {
      code:code||'CONFLICT_RESOLUTION_ERROR',
      message:message||'The conflict operation failed.'
    };
  }

  function isUuid(value){
    return typeof value==='string'&&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
        .test(value);
  }

  function createSecureUuid(options){
    if(options&&typeof options.uuidFactory==='function'){
      return String(options.uuidFactory());
    }
    if(global.crypto&&typeof global.crypto.randomUUID==='function'){
      return global.crypto.randomUUID();
    }
    if(global.crypto&&typeof global.crypto.getRandomValues==='function'){
      var bytes=new Uint8Array(16);
      global.crypto.getRandomValues(bytes);
      bytes[6]=(bytes[6]&15)|64;
      bytes[8]=(bytes[8]&63)|128;
      return Array.prototype.map.call(bytes,function(byte,index){
        var text=byte.toString(16).padStart(2,'0');
        return index===4||index===6||index===8||index===10
          ?'-'+text
          :text;
      }).join('');
    }
    throw new Error('SECURE_UUID_UNAVAILABLE');
  }

  function cloneValue(value){
    if(typeof global.structuredClone==='function'){
      return global.structuredClone(value);
    }
    return JSON.parse(JSON.stringify(value));
  }

  function normalizeRequestError(error){
    var message=error&&typeof error.message==='string'?error.message:'';
    if(/network|fetch|offline/i.test(message)){
      return safeError('NETWORK_ERROR','The conflict request failed.');
    }
    if(error&&error.code==='42501'){
      return safeError('ACCESS_DENIED','Access denied.');
    }
    return safeError(
      'CONFLICT_REQUEST_FAILED',
      'The conflict request failed.'
    );
  }

  function resolveOnlineContext(options){
    options=options&&typeof options==='object'?options:{};
    var client;
    var session;
    try{
      client=options.client||
        (global.SupabaseClientLayer&&
        typeof global.SupabaseClientLayer.getClient==='function'
          ?global.SupabaseClientLayer.getClient()
          :null);
      session=options.session||
        (global.SupabaseAuth&&
        typeof global.SupabaseAuth.getSession==='function'
          ?global.SupabaseAuth.getSession()
          :null);
    }catch(error){
      return {error:safeError(
        'SUPABASE_UNAVAILABLE',
        'Supabase is not available.'
      )};
    }
    if(!client||typeof client.from!=='function'){
      return {error:safeError(
        'SUPABASE_UNAVAILABLE',
        'Supabase is not configured.'
      )};
    }
    if(!session||!session.user||!isUuid(String(session.user.id||''))){
      return {error:safeError(
        'AUTH_REQUIRED',
        'An authenticated session is required.'
      )};
    }
    return {client:client};
  }

  function publicConflictStatus(databaseStatus){
    if(databaseStatus==='open')return 'pending';
    if(databaseStatus==='discarded')return 'ignored';
    return databaseStatus==='resolved'?'resolved':String(databaseStatus||'');
  }

  function mapConflictRow(row){
    return {
      conflictId:row.id,
      conferenceId:row.conference_id,
      operationId:row.operation_id||null,
      expectedRevision:row.expected_revision,
      actualRevision:row.actual_revision,
      localSnapshot:cloneValue(row.local_payload),
      serverSnapshot:cloneValue(row.server_snapshot),
      status:publicConflictStatus(row.status),
      createdAt:row.created_at,
      resolvedAt:row.resolved_at||null
    };
  }

  function conflictSelectFields(){
    return [
      'id',
      'conference_id',
      'operation_id',
      'expected_revision',
      'actual_revision',
      'local_payload',
      'server_snapshot',
      'status',
      'created_at',
      'resolved_at'
    ].join(',');
  }

  function getConflict(conflictId,options){
    conflictId=String(conflictId||'');
    if(!isUuid(conflictId)){
      return Promise.resolve(result(false,'error',null,safeError(
        'INVALID_CONFLICT_ID',
        'conflictId must be a valid UUID.'
      )));
    }
    var context=resolveOnlineContext(options);
    if(context.error){
      state.lastError=context.error;
      return Promise.resolve(result(false,'error',null,context.error));
    }
    return Promise.resolve().then(function(){
      return context.client
        .from('sync_conflicts')
        .select(conflictSelectFields())
        .eq('id',conflictId)
        .maybeSingle();
    }).then(function(response){
      if(response.error)throw response.error;
      state.lastReadAt=new Date().toISOString();
      state.lastError=null;
      if(!response.data)return result(true,'not_found',null,null);
      return result(true,'loaded',mapConflictRow(response.data),null);
    }).catch(function(error){
      state.lastError=normalizeRequestError(error);
      return result(false,'error',null,state.lastError);
    });
  }

  function normalizeListOptions(options){
    options=options&&typeof options==='object'?options:{};
    var status=options.status===undefined?null:String(options.status);
    if(status!==null&&
      !Object.prototype.hasOwnProperty.call(PUBLIC_STATUSES,status)){
      return {error:safeError(
        'INVALID_CONFLICT_STATUS',
        'status must be pending, resolved, or ignored.'
      )};
    }
    var limit=options.limit===undefined?50:options.limit;
    if(!Number.isInteger(limit)||limit<1||limit>100){
      return {error:safeError(
        'INVALID_LIMIT',
        'limit must be an integer between 1 and 100.'
      )};
    }
    return {status:status,limit:limit};
  }

  function listConferenceConflicts(conferenceId,options){
    conferenceId=String(conferenceId||'');
    if(!isUuid(conferenceId)){
      return Promise.resolve(result(false,'error',null,safeError(
        'INVALID_CONFERENCE_ID',
        'conferenceId must be a valid UUID.'
      )));
    }
    var normalized=normalizeListOptions(options);
    if(normalized.error){
      return Promise.resolve(result(false,'error',null,normalized.error));
    }
    var context=resolveOnlineContext(options);
    if(context.error){
      state.lastError=context.error;
      return Promise.resolve(result(false,'error',null,context.error));
    }
    return Promise.resolve().then(function(){
      var query=context.client
        .from('sync_conflicts')
        .select(conflictSelectFields())
        .eq('conference_id',conferenceId);
      if(normalized.status){
        query=query.eq('status',PUBLIC_STATUSES[normalized.status]);
      }
      return query
        .order('created_at',{ascending:true})
        .order('id',{ascending:true})
        .limit(normalized.limit);
    }).then(function(response){
      if(response.error)throw response.error;
      var conflicts=(Array.isArray(response.data)?response.data:[])
        .map(mapConflictRow)
        .sort(function(first,second){
          return String(first.createdAt).localeCompare(String(second.createdAt))||
            String(first.conflictId).localeCompare(String(second.conflictId));
        });
      state.lastReadAt=new Date().toISOString();
      state.lastError=null;
      return result(true,'loaded',{conflicts:conflicts},null);
    }).catch(function(error){
      state.lastError=normalizeRequestError(error);
      return result(false,'error',null,state.lastError);
    });
  }

  function isPlainObject(value){
    if(!value||Object.prototype.toString.call(value)!=='[object Object]'){
      return false;
    }
    var prototype=Object.getPrototypeOf(value);
    return prototype===Object.prototype||prototype===null;
  }

  function assertSupportedValue(value,stack,depth,maxDepth){
    if(depth>maxDepth)throw new Error('MAX_DEPTH_EXCEEDED');
    if(value===null)return;
    var type=typeof value;
    if(type==='string'||type==='boolean')return;
    if(type==='number'){
      if(!Number.isFinite(value))throw new Error('UNSUPPORTED_VALUE');
      return;
    }
    if(type!=='object')throw new Error('UNSUPPORTED_VALUE');
    if(!Array.isArray(value)&&!isPlainObject(value)){
      throw new Error('UNSUPPORTED_VALUE');
    }
    if(stack.indexOf(value)!==-1)throw new Error('CYCLIC_REFERENCE');
    stack.push(value);
    if(Array.isArray(value)){
      value.forEach(function(item){
        assertSupportedValue(item,stack,depth+1,maxDepth);
      });
    }else{
      Object.keys(value).forEach(function(key){
        assertSupportedValue(value[key],stack,depth+1,maxDepth);
      });
    }
    stack.pop();
  }

  function escapePathToken(token){
    return String(token).replace(/~/g,'~0').replace(/\//g,'~1');
  }

  function appendPath(path,token){
    return (path==='/'?'':path)+'/'+escapePathToken(token);
  }

  function arrayUsesIds(array){
    var ids=Object.create(null);
    return array.every(function(item){
      if(!isPlainObject(item)||
        (typeof item.id!=='string'&&typeof item.id!=='number')){
        return false;
      }
      var id=String(item.id).trim();
      if(!id||ids[id])return false;
      ids[id]=true;
      return true;
    });
  }

  function valuesEqual(first,second){
    return first===second||
      (typeof first==='number'&&typeof second==='number'&&
      Number.isNaN(first)&&Number.isNaN(second));
  }

  function compareSnapshots(localSnapshot,serverSnapshot,options){
    options=options&&typeof options==='object'?options:{};
    var maxDepth=options.maxDepth===undefined?50:options.maxDepth;
    var maxChanges=options.maxChanges===undefined?5000:options.maxChanges;
    if(!Number.isInteger(maxDepth)||maxDepth<1||maxDepth>200){
      return result(false,'error',null,safeError(
        'INVALID_MAX_DEPTH',
        'maxDepth must be an integer between 1 and 200.'
      ));
    }
    if(!Number.isInteger(maxChanges)||maxChanges<1||maxChanges>50000){
      return result(false,'error',null,safeError(
        'INVALID_MAX_CHANGES',
        'maxChanges must be an integer between 1 and 50000.'
      ));
    }
    try{
      assertSupportedValue(localSnapshot,[],0,maxDepth);
      assertSupportedValue(serverSnapshot,[],0,maxDepth);
    }catch(error){
      var validationCode=error&&error.message;
      return result(false,'error',null,safeError(
        validationCode==='CYCLIC_REFERENCE'
          ?'CYCLIC_REFERENCE'
          :validationCode==='MAX_DEPTH_EXCEEDED'
            ?'MAX_DEPTH_EXCEEDED'
            :'UNSUPPORTED_VALUE',
        'Snapshots contain unsupported or excessive data.'
      ));
    }

    var changes=[];
    var summary={added:0,removed:0,changed:0,unchanged:0};
    var includeUnchanged=options.includeUnchanged===true;
    var ignoredRootMetadata={
      updatedAt:true,lastOpenedAt:true,currentConferenceId:true,
      syncState:true,syncMetadata:true
    };

    function addChange(path,type,localExists,localValue,serverExists,serverValue){
      summary[type]++;
      if(type==='unchanged'&&!includeUnchanged)return;
      if(changes.length>=maxChanges)throw new Error('MAX_CHANGES_EXCEEDED');
      changes.push({
        path:path,
        type:type,
        localExists:localExists,
        serverExists:serverExists,
        localValue:localExists?cloneValue(localValue):null,
        serverValue:serverExists?cloneValue(serverValue):null
      });
    }

    function walk(localValue,serverValue,path,depth){
      if(depth>maxDepth)throw new Error('MAX_DEPTH_EXCEEDED');
      if(valuesEqual(localValue,serverValue)){
        addChange(path,'unchanged',true,localValue,true,serverValue);
        return;
      }
      var localArray=Array.isArray(localValue);
      var serverArray=Array.isArray(serverValue);
      if(localArray&&serverArray){
        if(arrayUsesIds(localValue)&&arrayUsesIds(serverValue)){
          var localById=Object.create(null);
          var serverById=Object.create(null);
          localValue.forEach(function(item){
            localById[String(item.id)]=item;
          });
          serverValue.forEach(function(item){
            serverById[String(item.id)]=item;
          });
          var ids=Object.keys(localById)
            .concat(Object.keys(serverById))
            .filter(function(id,index,all){return all.indexOf(id)===index;})
            .sort();
          ids.forEach(function(id){
            var hasLocal=Object.prototype.hasOwnProperty.call(localById,id);
            var hasServer=Object.prototype.hasOwnProperty.call(serverById,id);
            var itemPath=appendPath(path,'@id='+encodeURIComponent(id));
            if(!hasLocal){
              addChange(
                itemPath,'added',false,null,true,serverById[id]
              );
            }else if(!hasServer){
              addChange(
                itemPath,'removed',true,localById[id],false,null
              );
            }else{
              walk(localById[id],serverById[id],itemPath,depth+1);
            }
          });
          return;
        }
        var length=Math.max(localValue.length,serverValue.length);
        for(var index=0;index<length;index++){
          var localExists=index<localValue.length;
          var serverExists=index<serverValue.length;
          var indexPath=appendPath(path,index);
          if(!localExists){
            addChange(
              indexPath,'added',false,null,true,serverValue[index]
            );
          }else if(!serverExists){
            addChange(
              indexPath,'removed',true,localValue[index],false,null
            );
          }else{
            walk(localValue[index],serverValue[index],indexPath,depth+1);
          }
        }
        return;
      }
      if(isPlainObject(localValue)&&isPlainObject(serverValue)){
        var keys=Object.keys(localValue)
          .concat(Object.keys(serverValue))
          .filter(function(key,index,all){return all.indexOf(key)===index;})
          .sort();
        if(!keys.length){
          addChange(path,'unchanged',true,localValue,true,serverValue);
        }
        keys.forEach(function(key){
          if(path==='/'&&ignoredRootMetadata[key])return;
          var hasLocal=Object.prototype.hasOwnProperty.call(localValue,key);
          var hasServer=Object.prototype.hasOwnProperty.call(serverValue,key);
          var keyPath=appendPath(path,key);
          if(!hasLocal){
            addChange(
              keyPath,'added',false,null,true,serverValue[key]
            );
          }else if(!hasServer){
            addChange(
              keyPath,'removed',true,localValue[key],false,null
            );
          }else{
            walk(localValue[key],serverValue[key],keyPath,depth+1);
          }
        });
        return;
      }
      addChange(path,'changed',true,localValue,true,serverValue);
    }

    try{
      walk(localSnapshot,serverSnapshot,'/',0);
    }catch(error){
      return result(false,'error',null,safeError(
        error&&error.message==='MAX_CHANGES_EXCEEDED'
          ?'MAX_CHANGES_EXCEEDED'
          :'MAX_DEPTH_EXCEEDED',
        'Snapshot comparison limits were exceeded.'
      ));
    }
    changes.sort(function(first,second){
      return first.path.localeCompare(second.path)||
        first.type.localeCompare(second.type);
    });
    var different=summary.added+summary.removed+summary.changed;
    return result(true,'compared',{
      equal:different===0,
      summary:summary,
      changes:changes,
      arrayStrategy:'unique_id_else_index',
      pathFormat:'json_pointer_with_id_tokens'
    },null);
  }

  function classifyConflict(diffReport,options){
    options=options&&typeof options==='object'?options:{};
    if(!diffReport||typeof diffReport!=='object'||
      !diffReport.summary||!Array.isArray(diffReport.changes)){
      return result(false,'error',null,safeError(
        'INVALID_DIFF_REPORT',
        'A valid diff report is required.'
      ));
    }
    var count=Number(diffReport.summary.added||0)+
      Number(diffReport.summary.removed||0)+
      Number(diffReport.summary.changed||0);
    var sensitivePattern=options.sensitivePathPattern instanceof RegExp
      ?options.sensitivePathPattern
      :/(people|person|guest|child|guardian|room|house|capacity|assignment)/i;
    var hasRemoval=diffReport.changes.some(function(change){
      return change.type==='removed';
    });
    var hasSensitiveChange=diffReport.changes.some(function(change){
      return change.type!=='unchanged'&&sensitivePattern.test(change.path);
    });
    var level=count===0
      ?'none'
      :hasRemoval||hasSensitiveChange||count>=20
        ?'high'
        :count>=5
          ?'medium'
          :'low';
    return result(true,'classified',{
      level:level,
      changeCount:count,
      hasRemoval:hasRemoval,
      hasSensitiveChange:hasSensitiveChange
    },null);
  }

  function decodePath(path){
    if(path==='/')return [];
    if(typeof path!=='string'||path.charAt(0)!=='/'){
      throw new Error('INVALID_SELECTED_PATH');
    }
    return path.slice(1).split('/').map(function(token){
      return token.replace(/~1/g,'/').replace(/~0/g,'~');
    });
  }

  function findArrayIndex(array,token){
    if(token.indexOf('@id=')===0){
      var id=decodeURIComponent(token.slice(4));
      return array.findIndex(function(item){
        return item&&String(item.id)===id;
      });
    }
    return /^(0|[1-9][0-9]*)$/.test(token)?Number(token):-1;
  }

  function applyPathChoice(target,change){
    var tokens=decodePath(change.path);
    if(!tokens.length){
      return change.localExists?cloneValue(change.localValue):null;
    }
    var parent=target;
    for(var index=0;index<tokens.length-1;index++){
      var token=tokens[index];
      if(Array.isArray(parent)){
        var arrayIndex=findArrayIndex(parent,token);
        if(arrayIndex<0)throw new Error('INVALID_SELECTED_PATH');
        parent=parent[arrayIndex];
      }else if(parent&&typeof parent==='object'&&
        Object.prototype.hasOwnProperty.call(parent,token)){
        parent=parent[token];
      }else{
        throw new Error('INVALID_SELECTED_PATH');
      }
    }
    var last=tokens[tokens.length-1];
    if(Array.isArray(parent)){
      var lastIndex=findArrayIndex(parent,last);
      if(change.localExists){
        if(lastIndex<0){
          if(last.indexOf('@id=')!==0){
            throw new Error('INVALID_SELECTED_PATH');
          }
          parent.push(cloneValue(change.localValue));
        }else{
          parent[lastIndex]=cloneValue(change.localValue);
        }
      }else if(lastIndex>=0){
        parent.splice(lastIndex,1);
      }
    }else if(parent&&typeof parent==='object'){
      if(change.localExists){
        parent[last]=cloneValue(change.localValue);
      }else{
        delete parent[last];
      }
    }else{
      throw new Error('INVALID_SELECTED_PATH');
    }
    return target;
  }

  function normalizeResolutionMap(input){
    var map=Object.create(null);
    if(input.resolutionMap&&isPlainObject(input.resolutionMap)){
      Object.keys(input.resolutionMap).forEach(function(path){
        map[path]=input.resolutionMap[path];
      });
    }
    if(Array.isArray(input.selectedPaths)){
      input.selectedPaths.forEach(function(selection){
        if(!selection||typeof selection!=='object'){
          throw new Error('INVALID_SELECTED_PATH');
        }
        map[String(selection.path||'')]=selection.source;
      });
    }
    return map;
  }

  function compareManualApplicationOrder(first,second,changeByPath){
    var firstTokens=decodePath(first);
    var secondTokens=decodePath(second);
    var firstParent=firstTokens.slice(0,-1).join('/');
    var secondParent=secondTokens.slice(0,-1).join('/');
    var firstLast=firstTokens[firstTokens.length-1]||'';
    var secondLast=secondTokens[secondTokens.length-1]||'';
    var firstChange=changeByPath[first];
    var secondChange=changeByPath[second];
    if(firstParent===secondParent&&
      firstChange&&!firstChange.localExists&&
      secondChange&&!secondChange.localExists&&
      /^(0|[1-9][0-9]*)$/.test(firstLast)&&
      /^(0|[1-9][0-9]*)$/.test(secondLast)){
      return Number(secondLast)-Number(firstLast);
    }
    return secondTokens.length-firstTokens.length||
      first.localeCompare(second);
  }

  function buildResolutionPlan(input,options){
    input=input&&typeof input==='object'?input:{};
    options=options&&typeof options==='object'?options:{};
    var conflictId=String(input.conflictId||'');
    var strategy=String(input.strategy||'');
    if(!isUuid(conflictId)){
      return result(false,'error',null,safeError(
        'INVALID_CONFLICT_ID',
        'conflictId must be a valid UUID.'
      ));
    }
    if(STRATEGIES.indexOf(strategy)===-1){
      return result(false,'error',null,safeError(
        'INVALID_RESOLUTION_STRATEGY',
        'strategy must be keep_local, keep_server, or manual.'
      ));
    }
    if(!Number.isInteger(input.baseRevision)||input.baseRevision<0||
      !Number.isInteger(input.actualRevision)||input.actualRevision<0){
      return result(false,'error',null,safeError(
        'INVALID_REVISION',
        'Valid baseRevision and actualRevision values are required.'
      ));
    }
    var sourceOperationId=isUuid(String(input.operationId||''))
      ?String(input.operationId)
      :null;
    var resolutionOperationId;
    try{
      resolutionOperationId=input.resolutionOperationId
        ?String(input.resolutionOperationId)
        :createSecureUuid(options);
    }catch(error){
      return result(false,'error',null,safeError(
        'SECURE_UUID_UNAVAILABLE',
        'A secure resolution operationId could not be created.'
      ));
    }
    if(!isUuid(resolutionOperationId)){
      return result(false,'error',null,safeError(
        'INVALID_RESOLUTION_OPERATION_ID',
        'resolutionOperationId must be a valid UUID.'
      ));
    }
    if(sourceOperationId&&resolutionOperationId===sourceOperationId){
      return result(false,'error',null,safeError(
        'SOURCE_OPERATION_ID_REUSED',
        'The resolution operationId must differ from the source operation.'
      ));
    }
    var comparison=compareSnapshots(
      input.localSnapshot,
      input.serverSnapshot,
      options.compareOptions
    );
    if(!comparison.ok)return comparison;
    var resolvedSnapshot;
    var selectedPaths=[];
    try{
      if(strategy==='keep_local'){
        resolvedSnapshot=cloneValue(input.localSnapshot);
      }else if(strategy==='keep_server'){
        resolvedSnapshot=cloneValue(input.serverSnapshot);
      }else{
        var resolutionMap=normalizeResolutionMap(input);
        var differences=comparison.data.changes.filter(function(change){
          return change.type!=='unchanged';
        });
        var changeByPath=Object.create(null);
        differences.forEach(function(change){
          changeByPath[change.path]=change;
        });
        var decisionPaths=Object.keys(resolutionMap).sort();
        decisionPaths.forEach(function(path){
          if(!changeByPath[path]){
            throw new Error('INVALID_SELECTED_PATH');
          }
          if(resolutionMap[path]!=='local'&&resolutionMap[path]!=='server'){
            throw new Error('INVALID_RESOLUTION_SOURCE');
          }
        });
        if(options.allowPartial!==true&&
          decisionPaths.length!==differences.length){
          throw new Error('INCOMPLETE_MANUAL_RESOLUTION');
        }
        resolvedSnapshot=cloneValue(input.serverSnapshot);
        decisionPaths.filter(function(path){
          return resolutionMap[path]==='local';
        }).sort(function(first,second){
          return compareManualApplicationOrder(
            first,
            second,
            changeByPath
          );
        }).forEach(function(path){
          resolvedSnapshot=applyPathChoice(
            resolvedSnapshot,
            changeByPath[path]
          );
        });
        decisionPaths.forEach(function(path){
          selectedPaths.push({
            path:path,
            source:resolutionMap[path]
          });
        });
      }
    }catch(error){
      var planCode=error&&error.message;
      return result(false,'error',null,safeError(
        planCode||'RESOLUTION_PLAN_FAILED',
        planCode==='INCOMPLETE_MANUAL_RESOLUTION'
          ?'Every difference requires an explicit manual decision.'
          :'The resolution selections are invalid.'
      ));
    }
    var createdAt;
    try{
      var now=options.now===undefined
        ?new Date()
        :new Date(typeof options.now==='function'?options.now():options.now);
      if(Number.isNaN(now.getTime()))throw new Error('INVALID_DATE');
      createdAt=now.toISOString();
    }catch(error){
      return result(false,'error',null,safeError(
        'INVALID_DATE',
        'A valid plan creation time is required.'
      ));
    }
    return result(true,'planned',{
      conflictId:conflictId,
      conferenceId:isUuid(String(input.conferenceId||''))
        ?String(input.conferenceId)
        :null,
      strategy:strategy,
      baseRevision:input.actualRevision,
      actualRevision:input.actualRevision,
      sourceRevision:strategy==='keep_local'
        ?input.baseRevision
        :input.actualRevision,
      sourceOperationId:sourceOperationId,
      resolutionOperationId:resolutionOperationId,
      schemaVersion:String(input.schemaVersion||'').trim(),
      appVersion:String(input.appVersion||'').trim(),
      resolvedSnapshot:resolvedSnapshot,
      selectedPaths:selectedPaths,
      createdAt:createdAt
    },null);
  }

  function containsForbiddenPlanData(value,stack){
    if(value===null)return false;
    if(typeof value==='function'||typeof value==='symbol'||
      typeof value==='bigint'||typeof value==='undefined'){
      return true;
    }
    if(typeof value!=='object')return false;
    if(stack.indexOf(value)!==-1)return true;
    stack.push(value);
    var forbidden=false;
    Object.keys(value).some(function(key){
      if(/^(access_?token|refresh_?token|session|supabase_?client|client)$/i
        .test(key)){
        forbidden=true;
        return true;
      }
      if(containsForbiddenPlanData(value[key],stack)){
        forbidden=true;
        return true;
      }
      return false;
    });
    stack.pop();
    return forbidden;
  }

  function validateResolutionPlan(plan,options){
    if(!plan||typeof plan!=='object'||Array.isArray(plan)){
      return result(false,'error',null,safeError(
        'INVALID_RESOLUTION_PLAN',
        'A resolution plan object is required.'
      ));
    }
    var valid= isUuid(String(plan.conflictId||''))&&
      isUuid(String(plan.conferenceId||''))&&
      isUuid(String(plan.resolutionOperationId||''))&&
      STRATEGIES.indexOf(plan.strategy)!==-1&&
      Object.prototype.hasOwnProperty.call(plan,'resolvedSnapshot')&&
      Number.isInteger(plan.baseRevision)&&plan.baseRevision>=0&&
      Number.isInteger(plan.actualRevision)&&plan.actualRevision>=0&&
      plan.baseRevision===plan.actualRevision&&
      Number.isInteger(plan.sourceRevision)&&plan.sourceRevision>=0&&
      String(plan.schemaVersion||'').trim()!==''&&
      String(plan.appVersion||'').trim()!=='';
    if(valid&&plan.sourceOperationId&&
      String(plan.sourceOperationId)===String(plan.resolutionOperationId)){
      valid=false;
    }
    if(valid&&plan.operationId&&
      String(plan.operationId)===String(plan.resolutionOperationId)){
      valid=false;
    }
    if(!valid){
      return result(false,'error',null,safeError(
        'INVALID_RESOLUTION_PLAN',
        'The resolution plan is incomplete or invalid.'
      ));
    }
    try{
      assertSupportedValue(
        plan.resolvedSnapshot,
        [],
        0,
        options&&Number.isInteger(options.maxDepth)?options.maxDepth:100
      );
      if(containsForbiddenPlanData(plan,[])){
        throw new Error('FORBIDDEN_PLAN_DATA');
      }
    }catch(error){
      return result(false,'error',null,safeError(
        'UNSAFE_RESOLUTION_PLAN',
        'The resolution plan contains unsafe or unsupported data.'
      ));
    }
    return result(true,'valid',{valid:true},null);
  }

  function getState(){
    return {
      lastReadAt:state.lastReadAt,
      lastError:state.lastError
        ?{code:state.lastError.code,message:state.lastError.message}
        :null
    };
  }

  function resetForTests(){
    state.lastReadAt=null;
    state.lastError=null;
  }

  global.ConflictResolution=Object.freeze({
    getConflict:getConflict,
    listConferenceConflicts:listConferenceConflicts,
    compareSnapshots:compareSnapshots,
    classifyConflict:classifyConflict,
    buildResolutionPlan:buildResolutionPlan,
    validateResolutionPlan:validateResolutionPlan,
    getState:getState,
    resetForTests:resetForTests
  });
})(window);
