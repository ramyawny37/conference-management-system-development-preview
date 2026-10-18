(function(global){
  'use strict';
  var direct=['public.get_first_system_bootstrap_status()','public.complete_first_system_bootstrap(text,uuid,text,text,uuid)','platform.get_my_device_key_binding_status()','platform.begin_device_session_challenge(uuid)','platform.get_my_device_authorization()','platform.register_current_device(text,text,text)'];
  var entries=[
    ['get_user_management_actor_capabilities','public.get_user_management_actor_capabilities(uuid)'],
    ['search_user_management_users','public.search_user_management_users(uuid,text,text,integer)'],
    ['get_user_management_overview','public.get_user_management_overview(uuid,uuid)'],
    ['get_user_management_devices','public.get_user_management_devices(uuid,uuid)'],
    ['get_user_management_account','public.get_user_management_account(uuid,uuid)'],
    ['device_guarded_manage_system_user','public.device_guarded_manage_system_user(uuid,uuid,uuid,text,boolean)'],
    ['list_system_owner_pending_device_authorizations','public.list_system_owner_pending_device_authorizations_for_session(uuid)'],
    ['list_module_permission_grants','public.list_module_permission_grants(uuid,text,uuid)'],
    ['search_module_permission_candidates','public.search_module_permission_candidates(uuid,text,text,integer)'],
    ['list_module_permission_catalog_for_administration','public.list_module_permission_catalog_for_administration(uuid,text)'],
    ['list_module_permission_resources_for_administration','public.list_module_permission_resources_for_administration(uuid,text,text)'],
    ['manage_catalog_module_grant','public.manage_catalog_module_grant(uuid,uuid,text,uuid,text,text,text,text,uuid,text)'],
    ['manage_foundation_module_grant','public.manage_foundation_module_grant(uuid,uuid,text,uuid,text,text,uuid,text)'],
    ['recover_revoke_final_module_manager','public.recover_revoke_final_module_manager(uuid,uuid,text,uuid,uuid,text)'],
    ['acquire_conference_lock','public.device_guarded_acquire_conference_lock(uuid,uuid,uuid,integer)'],
    ['renew_conference_lock','public.device_guarded_renew_conference_lock(uuid,uuid,uuid,integer)'],
    ['release_conference_lock','public.device_guarded_release_conference_lock(uuid,uuid,uuid)'],
    ['get_conference_lock','public.device_guarded_get_conference_lock(uuid,uuid)'],
    ['acquire_conference_section_lock','public.acquire_conference_section_lock(uuid,text,uuid,uuid,integer)'],
    ['renew_conference_section_lock','public.renew_conference_section_lock(uuid,text,uuid,uuid,integer)'],
    ['release_conference_section_lock','public.release_conference_section_lock(uuid,text,uuid,uuid)'],
    ['get_conference_section_lock','public.get_conference_section_lock(uuid,text,uuid)']
  ];
  var conferenceOperations=new Set(['acquire_conference_lock','renew_conference_lock','release_conference_lock','get_conference_lock','acquire_conference_section_lock','renew_conference_section_lock','release_conference_section_lock','get_conference_section_lock']);
  var map=Object.create(null);entries.forEach(function(row){map[row[0]]={signature:row[1],module:conferenceOperations.has(row[0])?'conference':'platform'};});
  var internal=['platform.get_device_session_challenge_context(uuid,uuid)','platform.complete_device_session(uuid,uuid,uuid,uuid,uuid,text,uuid,bytea)','platform.verify_device_session(uuid,uuid,bytea)','platform.execute_device_operation(uuid,uuid,bytea,text,text,jsonb)','platform.execute_conference_device_operation(uuid,uuid,bytea,text,jsonb)','platform_private.require_exact_jsonb_keys(jsonb,text[],text[])','platform.approve_device_authorization(uuid,text)','platform.block_device_authorization(uuid,text)','platform.revoke_device_authorization(uuid,text)','platform.set_account_status(uuid,text,text)','platform.grant_user_role(uuid,text,text,text,uuid)','platform.revoke_user_role(uuid)','platform.grant_role_permission(text,text,text)','platform.revoke_role_permission(text,text,text)','public.grant_system_role(uuid,text)','public.revoke_system_role(uuid,text)'];
  var policy=['platform.has_permission(text,text,uuid)','public.is_account_approved(uuid)','public.is_system_admin(uuid)','public.is_system_owner(uuid)'];
  global.ConferenceDeviceOperationContract=Object.freeze({DIRECT_BROWSER_REQUIRED:Object.freeze(direct),EDGE_ONLY_PROTECTED:Object.freeze(entries.map(function(row){return Object.freeze({operation:row[0],signature:row[1]});})),INTERNAL_ONLY:Object.freeze(internal),POLICY_HELPER_BROWSER_READ:Object.freeze(policy),isProtectedOperation:function(name){return Object.prototype.hasOwnProperty.call(map,String(name||''));},moduleFor:function(name){var entry=map[String(name||'')];return entry&&entry.module||null;},signatureFor:function(name){var entry=map[String(name||'')];return entry&&entry.signature||null;}});
})(window);
