(function(global){
  'use strict';

  var records=[];
  var generation=0;
  var accountUserId='';
  var accountClient=null;
  var runTail=Promise.resolve();

  function copy(value){
    if(typeof global.structuredClone==='function')return global.structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }

  function currentClient(){
    return global.SupabaseClientLayer&&
      typeof global.SupabaseClientLayer.getClient==='function'
      ?global.SupabaseClientLayer.getClient():null;
  }

  function currentUserId(){
    var auth=global.SupabaseAuth&&
      typeof global.SupabaseAuth.getState==='function'
      ?global.SupabaseAuth.getState():null;
    return String(auth&&auth.user&&auth.user.id||'');
  }

  function render(){
    if(typeof global.showStartupConferenceList==='function'){
      global.showStartupConferenceList();
    }
  }

  function clear(options){
    options=options&&typeof options==='object'?options:{};
    generation++;
    records=[];
    accountUserId='';
    accountClient=null;
    if(options.render!==false)render();
    return {ok:true,status:'cleared'};
  }

  function validRun(runGeneration,userId,client){
    return generation===runGeneration&&client===currentClient()&&
      userId===currentUserId();
  }

  function validSnapshot(value){
    return value&&typeof value==='object'&&!Array.isArray(value)&&
      (value.status==='active'||value.status==='completed');
  }

  function performRefresh(runGeneration,options){
    options=options&&typeof options==='object'?options:{};
    if(runGeneration!==generation){
      return Promise.resolve({ok:false,status:'stale'});
    }
    var remote=options.remote||global.SupabaseSnapshotSync;
    var client=currentClient();
    var userId=currentUserId();
    if(!client||!userId||!remote||
      typeof remote.listAvailableConferences!=='function'||
      typeof remote.downloadSnapshot!=='function'){
      clear();
      return Promise.resolve({ok:false,status:'prerequisites_missing'});
    }
    if(accountUserId&&
      (accountUserId!==userId||accountClient!==client)){
      clear({render:false});
    }
    accountUserId=userId;
    accountClient=client;
    return Promise.resolve(remote.listAvailableConferences())
      .then(function(listed){
        if(!validRun(runGeneration,userId,client)){
          return {ok:false,status:'stale'};
        }
        if(!listed||!listed.ok||!listed.data||
          !Array.isArray(listed.data.conferences)){
          return {ok:false,status:'list_failed'};
        }
        var available=[];
        var seen=Object.create(null);
        listed.data.conferences.forEach(function(item){
          var remoteId=String(item&&item.id||'');
          if(!remoteId||seen[remoteId])return;
          seen[remoteId]=true;
          available.push(item);
        });
        var discovered=[];
        var sequence=Promise.resolve();
        available.forEach(function(item){
          sequence=sequence.then(function(){
            if(!validRun(runGeneration,userId,client))return null;
            return remote.downloadSnapshot(String(item.id)).then(function(downloaded){
              if(!validRun(runGeneration,userId,client))return null;
              var snapshot=downloaded&&downloaded.ok&&
                downloaded.status==='downloaded'&&downloaded.data
                ?downloaded.data.snapshot:null;
              if(!validSnapshot(snapshot))return null;
              discovered.push({
                authenticatedUserId:userId,
                discoveryGeneration:runGeneration,
                remoteConferenceId:String(item.id),
                revision:downloaded.data.revision,
                schemaVersion:downloaded.data.schemaVersion||null,
                appVersion:downloaded.data.appVersion||null,
                role:item.role,
                listing:copy(item),
                conference:copy(snapshot)
              });
              return null;
            }).catch(function(){return null;});
          });
        });
        return sequence.then(function(){
          if(!validRun(runGeneration,userId,client)){
            return {ok:false,status:'stale'};
          }
          records=discovered;
          render();
          return {
            ok:true,
            status:'discovered',
            data:{conferences:copy(records)}
          };
        });
      }).then(function(result){
        if(result&&result.status==='list_failed')render();
        return result;
      }).catch(function(){
        if(validRun(runGeneration,userId,client))render();
        return {ok:false,status:'network_error'};
      });
  }

  function refresh(options){
    options=options&&typeof options==='object'?options:{};
    var runGeneration=++generation;
    var flight=runTail.catch(function(){return null;}).then(function(){
      return performRefresh(runGeneration,options);
    });
    runTail=flight.catch(function(){return null;});
    return flight;
  }

  function getRecords(){
    if(accountUserId!==currentUserId()||accountClient!==currentClient()){
      generation++;
      records=[];
      accountUserId='';
      accountClient=null;
    }
    return copy(records);
  }

  function getRecord(remoteConferenceId){
    remoteConferenceId=String(remoteConferenceId||'');
    var values=getRecords();
    for(var index=0;index<values.length;index++){
      if(values[index].remoteConferenceId===remoteConferenceId&&
        values[index].discoveryGeneration===generation){
        return values[index];
      }
    }
    return null;
  }
  function getGeneration(){return generation;}

  global.StartupConferenceDiscovery=Object.freeze({
    refresh:refresh,
    clear:clear,
    getRecords:getRecords,
    getRecord:getRecord,
    getGeneration:getGeneration
  });
})(window);
