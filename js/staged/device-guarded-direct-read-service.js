(function(global){
  'use strict';
  // P0.3C staged only. Not loaded or activated before P0.3E.
  function create(client,deviceId){
    function rpc(name,args){return client.rpc(name,Object.assign({p_actor_device_id:deviceId},args||{}));}
    return Object.freeze({
      membership:function(conferenceId){return rpc('device_guarded_get_my_conference_membership',{p_conference_id:conferenceId});},
      conferences:function(){return rpc('device_guarded_list_available_conferences');},
      snapshotMetadata:function(conferenceId){return rpc('device_guarded_get_conference_snapshot_metadata',{p_conference_id:conferenceId});},
      snapshot:function(conferenceId){return rpc('device_guarded_download_conference_snapshot',{p_conference_id:conferenceId});}
    });
  }
  global.P03CStagedDirectReadService=Object.freeze({create:create});
})(window);
