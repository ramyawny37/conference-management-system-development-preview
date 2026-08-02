(function(global){
  'use strict';

  // P0.3C staged artifact. It is deliberately not loaded by index.html or the
  // service worker and must not replace any active P0.2 global before P0.3E.
  function create(options){
    options=options||{};
    var client=options.client;
    var deviceId=String(options.deviceId||'');
    function restrictedCall(name,args){
      if(!client||typeof client.rpc!=='function'){
        return Promise.resolve({data:null,error:{code:'SUPABASE_UNAVAILABLE'}});
      }
      return client.rpc(name,args||{});
    }
    function call(name,args){
      if(!client||typeof client.rpc!=='function'){
        return Promise.resolve({data:null,error:{code:'SUPABASE_UNAVAILABLE'}});
      }
      args=Object.assign({p_actor_device_id:deviceId},args||{});
      return client.rpc(name,args);
    }
    return Object.freeze({
      getSystemAccess:function(){return restrictedCall('get_my_device_aware_system_access',{p_device_id:deviceId});},
      listOrganizations:function(){return call('device_guarded_list_my_organizations');},
      getOrganizationAccess:function(organizationId){return call('device_guarded_get_my_organization_access',{p_organization_id:organizationId});},
      listOrganizationMembers:function(organizationId){return call('device_guarded_list_organization_members',{p_organization_id:organizationId});},
      lookupOrganizationCandidate:function(organizationId,email){return call('device_guarded_lookup_organization_candidate_by_email',{p_organization_id:organizationId,p_email:email});},
      getConferenceAccess:function(conferenceId){return call('device_guarded_get_my_conference_access',{p_conference_id:conferenceId});},
      listConferenceMembers:function(conferenceId){return call('device_guarded_list_conference_members',{p_conference_id:conferenceId});},
      lookupConferenceUser:function(conferenceId,email){return call('device_guarded_lookup_conference_user_by_email',{p_conference_id:conferenceId,p_email:email});},
      getConferenceLock:function(conferenceId){return call('device_guarded_get_conference_lock',{p_conference_id:conferenceId});},
      getConferenceCreationOperation:function(operationId){return call('device_guarded_get_conference_creation_operation',{p_operation_id:operationId});},
      getSyncConflict:function(conflictId){return call('device_guarded_get_sync_conflict',{p_conflict_id:conflictId});},
      listSyncConflicts:function(conferenceId,status,limit){return call('device_guarded_list_sync_conflicts',{p_conference_id:conferenceId,p_status:status,p_limit:limit});},
      addOrganizationMember:function(organizationId,targetUserId,operationId){return call('device_guarded_add_organization_member',{p_organization_id:organizationId,p_target_user_id:targetUserId,p_operation_id:operationId});},
      removeOrganizationMember:function(organizationId,targetUserId,operationId){return call('device_guarded_remove_organization_member',{p_organization_id:organizationId,p_target_user_id:targetUserId,p_operation_id:operationId});},
      changeOrganizationRole:function(organizationId,targetUserId,targetRole,operationId){return call('device_guarded_change_organization_role',{p_organization_id:organizationId,p_target_user_id:targetUserId,p_target_role:targetRole,p_operation_id:operationId});},
      addConferenceManager:function(conferenceId,targetUserId,operationId){return call('device_guarded_add_conference_manager',{p_conference_id:conferenceId,p_target_user_id:targetUserId,p_operation_id:operationId});},
      removeConferenceManager:function(conferenceId,targetUserId,operationId){return call('device_guarded_remove_conference_manager',{p_conference_id:conferenceId,p_target_user_id:targetUserId,p_operation_id:operationId});},
      createConference:function(operationId,requestedConferenceId,name,metadata){return call('device_guarded_create_conference_idempotent',{p_operation_id:operationId,p_requested_conference_id:requestedConferenceId,p_name:name,p_initial_metadata:metadata});},
      applySnapshot:function(conferenceId,operationId,baseRevision,snapshot,schemaVersion,appVersion){return call('device_guarded_apply_conference_snapshot',{p_conference_id:conferenceId,p_operation_id:operationId,p_base_revision:baseRevision,p_snapshot:snapshot,p_schema_version:schemaVersion,p_app_version:appVersion});},
      acquireConferenceLock:function(conferenceId,lockToken,ttlSeconds){return call('device_guarded_acquire_conference_lock',{p_conference_id:conferenceId,p_lock_token:lockToken,p_ttl_seconds:ttlSeconds});},
      renewConferenceLock:function(conferenceId,lockToken,ttlSeconds){return call('device_guarded_renew_conference_lock',{p_conference_id:conferenceId,p_lock_token:lockToken,p_ttl_seconds:ttlSeconds});},
      releaseConferenceLock:function(conferenceId,lockToken){return call('device_guarded_release_conference_lock',{p_conference_id:conferenceId,p_lock_token:lockToken});},
      resolveSyncConflict:function(conflictId,conferenceId,resolutionOperationId,expectedRevision,strategy,resolvedSnapshot,schemaVersion,appVersion){return call('device_guarded_resolve_sync_conflict',{p_conflict_id:conflictId,p_conference_id:conferenceId,p_resolution_operation_id:resolutionOperationId,p_expected_revision:expectedRevision,p_strategy:strategy,p_resolved_snapshot:resolvedSnapshot,p_schema_version:schemaVersion,p_app_version:appVersion});}
    });
  }
  global.P03CStagedDeviceGuardedRuntime=Object.freeze({create:create});
})(window);
