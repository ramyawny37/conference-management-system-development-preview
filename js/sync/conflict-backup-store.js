(function(global){
  'use strict';
  var STORE='conflict_resolution_backups';
  function copy(value){
    if(typeof global.structuredClone==='function')return global.structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }
  function repository(options){
    return options&&options.indexedDb||global.AppIndexedDB;
  }
  function create(input,options){
    input=input||{};
    if(!input.localConferenceId||!input.snapshot||
      !input.conflictId||!Number.isInteger(input.resolvedRevision)){
      return Promise.resolve({ok:false,status:'invalid'});
    }
    var now=new Date().toISOString();
    var record={
      backupId:String(input.localConferenceId)+'::'+now+'::'+
        String(input.conflictId),
      localConferenceId:String(input.localConferenceId),
      snapshot:copy(input.snapshot),
      createdAt:now,
      conflictId:String(input.conflictId),
      resolvedRevision:input.resolvedRevision
    };
    var repo=repository(options);
    return repo.putRecord(STORE,record).then(function(){
      return repo.getAllRecords(STORE);
    }).then(function(records){
      var own=records.filter(function(item){
        return item.localConferenceId===record.localConferenceId;
      }).sort(function(a,b){return b.createdAt.localeCompare(a.createdAt);});
      return Promise.all(own.slice(3).map(function(item){
        return repo.deleteRecord(STORE,item.backupId);
      }));
    }).then(function(){
      return {ok:true,status:'created',data:copy(record)};
    }).catch(function(){return {ok:false,status:'storage_error'};});
  }
  function list(localConferenceId,options){
    return repository(options).getAllRecords(STORE).then(function(records){
      return records.filter(function(item){
        return item.localConferenceId===String(localConferenceId||'');
      }).sort(function(a,b){return b.createdAt.localeCompare(a.createdAt);})
        .map(copy);
    }).catch(function(){return [];});
  }
  global.ConflictBackupStore=Object.freeze({create:create,list:list});
})(window);
