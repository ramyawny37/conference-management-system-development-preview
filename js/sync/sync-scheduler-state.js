(function(global){
  'use strict';

  var CONNECTIVITY=Object.freeze([
    'unknown','browser_offline','checking','online',
    'service_unreachable','auth_required','stopped'
  ]);
  var CONFERENCE_STATES=Object.freeze([
    'local_only','cloud_disabled','auth_required','link_scheduled','linking',
    'link_pending','linked','linked_idle','sync_pending','syncing','offline_pending',
    'remote_update_available','auto_reviewing','applying_remote',
    'needs_resolution','sync_error'
  ]);

  function create(){
    return {
      started:false,
      connectivity:'unknown',
      conferenceState:'local_only',
      scheduledReasons:[],
      evaluating:false,
      checkingConnectivity:false,
      generation:0,
      queueStatus:'idle',
      activeConferenceId:null,
      linkedConferenceId:null,
      lastRunAt:null,
      lastSuccessfulSyncAt:null,
      lastSafeError:null,
      pendingCount:0,
      conflictCount:0,
      nextRetryAt:null,
      lastEvaluationAt:null,
      lastConnectivityCheckAt:null,
      lastError:null
    };
  }

  function isConnectivity(value){
    return CONNECTIVITY.indexOf(value)>=0;
  }

  global.SyncSchedulerState=Object.freeze({
    connectivityStates:CONNECTIVITY,
    conferenceStates:CONFERENCE_STATES,
    create:create,
    isConnectivity:isConnectivity
  });
})(window);
