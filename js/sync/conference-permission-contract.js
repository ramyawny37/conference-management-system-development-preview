(function(global){
  'use strict';

  // Phase 2A is a descriptive contract only. Runtime authorization must not
  // consume these bundles until a later enforcement phase is approved.
  var SECTIONS=Object.freeze([
    'accommodation','transport','accounts','restaurant','air_conditioning',
    'reports','cards','search','settings','people','templates'
  ]);
  var ACTIONS=Object.freeze([
    'display','read','create','update','delete','export','print','import','sync'
  ]);
  var CONFERENCE_ACTIONS=Object.freeze([
    'conference.display','conference.read_protected',
    'conference.edit_metadata','conference.complete','conference.archive',
    'conference.restore_archive','conference.delete','conference.sync',
    'conference.resolve_conflict','conference.manage_members',
    'conference.export_full','conference.backup_full','conference.restore_full'
  ]);
  var ROLES=Object.freeze([
    'owner','manager','viewer','accommodation_viewer','transport_viewer'
  ]);

  function sectionPermissions(definitions){
    var output=Object.create(null);
    Object.keys(definitions).forEach(function(section){
      output[section]=Object.freeze(definitions[section].slice());
    });
    return Object.freeze(output);
  }
  var READ_ONLY_ACTIONS=['display','read'];
  var OPERATION_SECTION_PERMISSIONS=Object.freeze({
    accommodation:Object.freeze(['display','read','create','update','delete','import']),
    transport:Object.freeze(['display','read','create','update','delete']),
    accounts:Object.freeze(['display','read','create','update','delete']),
    restaurant:Object.freeze(['display','read','create','update','delete']),
    air_conditioning:Object.freeze(['display','read','update']),
    reports:Object.freeze(['display','read','export','print']),
    cards:Object.freeze(['display','read','export','print']),
    search:Object.freeze(['display','read']),
    settings:Object.freeze(['display','read']),
    people:Object.freeze(['display','read','create','update','delete','import']),
    templates:Object.freeze(['display','read','create','update','delete'])
  });
  function readOnlySections(sectionNames){
    var definitions=Object.create(null);
    sectionNames.forEach(function(section){definitions[section]=READ_ONLY_ACTIONS;});
    return sectionPermissions(definitions);
  }
  var ROLE_BUNDLES=Object.freeze({
    owner:Object.freeze({
      conference:Object.freeze(CONFERENCE_ACTIONS.slice()),
      sections:sectionPermissions(OPERATION_SECTION_PERMISSIONS)
    }),
    manager:Object.freeze({
      conference:Object.freeze([
        'conference.display','conference.read_protected',
        'conference.edit_metadata','conference.complete','conference.sync',
        'conference.resolve_conflict'
      ]),
      sections:sectionPermissions(OPERATION_SECTION_PERMISSIONS)
    }),
    viewer:Object.freeze({
      conference:Object.freeze([
        'conference.display','conference.read_protected'
      ]),
      sections:readOnlySections(SECTIONS)
    }),
    accommodation_viewer:Object.freeze({
      conference:Object.freeze([
        'conference.display','conference.read_protected'
      ]),
      sections:readOnlySections(['accommodation'])
    }),
    transport_viewer:Object.freeze({
      conference:Object.freeze([
        'conference.display','conference.read_protected'
      ]),
      sections:readOnlySections(['transport'])
    })
  });

  function mutation(handler,section,action,notes,details){
    var actions=Array.isArray(action)?action.slice():action?[action]:[];
    details=details||{};
    return Object.freeze({
      handler:handler,section:section,action:Object.freeze(actions),
      status:details.status||
        (section&&actions.length?'classified':'unresolved'),
      entity:details.entity||null,operation:details.operation||null,
      discriminator:details.discriminator||null,
      shadowGate:details.shadowGate||null,notes:notes||''
    });
  }
  var MUTATION_CATALOG=Object.freeze([
    mutation('addActivityLog',null,null,
      'Internal persisted audit side effect; it inherits the authorization of the initiating operation and grants no permission by itself.',
      {status:'internal_side_effect',entity:'conference_activity_log',operation:'append',discriminator:'initiating_operation',shadowGate:'not_applicable'}),
    mutation('saveHouse','accommodation',['create','update'],'Mode is selected by editHouseId.'),
    mutation('deleteHouse','accommodation','delete'),
    mutation('setAccommodationPersonArrival','accommodation','update'),
    mutation('setAccommodationRoomKeyHolder','accommodation','update'),
    mutation('removeConferenceHouseFromAccommodation','accommodation','delete'),
    mutation('addAvailableTemplateRoom','accommodation','create'),
    mutation('toggleActiveRoom','accommodation','update'),
    mutation('setAllActiveRoomsForFloor','accommodation','update'),
    mutation('setAllActiveRoomsForHouse','accommodation','update'),
    mutation('saveRoomData','accommodation','update','Also creates room occupancy records.'),
    mutation('partialTransferGuest','accommodation',null,
      'Opens the partial-transfer flow; mutation occurs in partialTransferConfirmSelection.',
      {status:'flow_entry',entity:'room_occupancy',operation:'open_transfer_flow',shadowGate:'phase2b_legacy'}),
    mutation('partialTransferConfirmSelection','accommodation','update',
      'Moves selected guests and persists the room mutation.',
      {entity:'room_occupancy',operation:'partial_transfer',shadowGate:'pending'}),
    mutation('clearConferenceRoom','accommodation','delete','Deletes room occupancy, not the room.'),
    mutation('toggleConferenceRoomClosed','accommodation','update'),
    mutation('deleteConferenceRoom','accommodation','delete'),
    mutation('applyConferenceHouseTemplate','accommodation','import','Applies appData.houseTemplates content to the current conference.',
      {entity:'house_template',operation:'apply_to_conference'}),
    mutation('importHouseFromTemplate','accommodation','import','Imports rooms from appData.houseTemplates into the current conference.',
      {entity:'house_template',operation:'import_rooms'}),
    mutation('updateAccommodationV3Setting','accommodation','update',
      'Mutates conference.accommodationV3 pricing configuration, not accounts storage.',
      {entity:'accommodation_pricing',operation:'update',shadowGate:'pending'}),
    mutation('updateAccommodationV3RoomTypePrice','accommodation','update',
      'Mutates conference.accommodationV3.roomTypePrices.',
      {entity:'accommodation_pricing',operation:'update_room_type_price',shadowGate:'pending'}),

    mutation('saveTransport','transport',['create','update'],'Mode is selected by editTransportId.'),
    mutation('deleteTransport','transport','delete'),
    mutation('saveSeat','transport','update'),
    mutation('removeTransportSeatRider','transport','delete'),
    mutation('clearSeat','transport','delete'),
    mutation('doBulkAssign','transport','update'),

    mutation('saveFinancialItemsSettings','accounts','update'),
    mutation('saveIncomeItemsSettings','accounts','update'),
    mutation('saveSettlementsSettings','accounts','update'),
    mutation('saveFinancialV3Adjustment','accounts',['create','update'],'Mode is selected by draft.editingId.'),
    mutation('deleteFinancialV3Adjustment','accounts','delete'),
    mutation('saveAccommodationDefaults','accounts','update'),
    mutation('saveAccommodationHouseSettings','accounts','update'),
    mutation('saveAccommodationRoomSettings','accounts','update'),
    mutation('resetAccommodationHouseSettings','accounts','update',
      'Resets saved house billing overrides while retaining room overrides.',
      {entity:'accommodation_account_settings',operation:'reset_house',shadowGate:'pending'}),
    mutation('resetAccommodationHouseAndRoomsSettings','accounts','delete',
      'Deletes the saved billing customization subtree for a house.',
      {entity:'accommodation_account_settings',operation:'delete_house_overrides',shadowGate:'pending'}),
    mutation('clearAccommodationRoomSettings','accounts','delete',
      'Deletes one saved room billing customization.',
      {entity:'accommodation_account_settings',operation:'delete_room_override',shadowGate:'pending'}),
    mutation('saveConferenceFinancialReportAsPdf','reports','export'),
    mutation('exportConferenceFinancialReportToExcel','reports','export'),
    mutation('printConferenceFinancialReport','reports','print'),

    mutation('setRestaurantV3MealBoundary','restaurant','update'),
    mutation('setRestaurantV3BasePrice','restaurant','update'),
    mutation('saveRestaurantV3PriceOverride','restaurant',['create','update'],'Existing day/meal keys are replaced.'),
    mutation('deleteRestaurantV3PriceOverride','restaurant','delete'),
    mutation('saveRestaurantV3CountOverride','restaurant',['create','update'],'Existing day/meal keys are replaced.'),
    mutation('deleteRestaurantV3CountOverride','restaurant','delete'),
    mutation('saveRestaurantV3PersonOverride','restaurant',['create','update'],'Existing person/day/meal keys are replaced.'),
    mutation('deleteRestaurantV3PersonOverride','restaurant','delete'),
    mutation('saveMealsDefaults','restaurant','update'),
    mutation('saveMealsDaySettings','restaurant','update'),
    mutation('clearMealsDaySettings','restaurant','delete'),

    mutation('updateAirConditioningV3Setting','air_conditioning','update'),
    mutation('saveAirConditioningDefaults','air_conditioning','update'),
    mutation('saveAirConditioningHouseSettings','air_conditioning','update'),
    mutation('saveAirConditioningRoomSettings','air_conditioning','update'),
    mutation('resetAirConditioningHouseSettings','air_conditioning','update',
      'Resets saved house air-conditioning overrides while retaining room overrides.',
      {entity:'air_conditioning_account_settings',operation:'reset_house',shadowGate:'pending'}),
    mutation('resetAirConditioningHouseAndRoomsSettings',null,null,
      'Deletes an air-conditioning customization subtree, but the current air_conditioning bundle has no delete grant.',
      {status:'unresolved',entity:'air_conditioning_account_settings',operation:'delete_house_overrides',shadowGate:'pending'}),
    mutation('clearAirConditioningRoomSettings',null,null,
      'Deletes one air-conditioning room customization, but the current air_conditioning bundle has no delete grant.',
      {status:'unresolved',entity:'air_conditioning_account_settings',operation:'delete_room_override',shadowGate:'pending'}),

    mutation('printV3Reports','reports','print'),
    mutation('saveV3ReportsPdf','reports','export'),
    mutation('exportV3ReportsExcel','reports','export'),
    mutation('printOne','cards','print'),
    mutation('printSel','cards','print'),
    mutation('downloadCardPng','cards','export'),
    mutation('downloadSelectedCards','cards','export'),
    mutation('shareCard',null,null,'Opens the single-card share center; it does not share a card.',
      {status:'flow_entry',entity:'card',operation:'open_share_flow',shadowGate:'pending'}),
    mutation('shareSelectedCards',null,null,
      'Opens the selected-card share flow; addActivityLog records flow start as an inherited internal side effect.',
      {status:'flow_entry',entity:'card_selection',operation:'open_share_flow',shadowGate:'pending'}),
    mutation('shareSelectedCardsFiles',null,null,'Future action candidate: share.'),
    mutation('shareCenterViaSystem',null,null,'Performs native single-card file sharing; no canonical share action exists.',
      {status:'unresolved',entity:'card',operation:'share_native',shadowGate:'pending'}),
    mutation('openShareCenterWhatsApp',null,null,'Copies a single-card image and opens WhatsApp; no canonical share action exists.',
      {status:'unresolved',entity:'card',operation:'share_whatsapp',shadowGate:'pending'}),
    mutation('shareSelectedQueueCard',null,null,'Performs native sharing for the current card in the selected-card queue; no canonical share action exists.',
      {status:'unresolved',entity:'card',operation:'share_native_queue',shadowGate:'pending'}),
    mutation('openSelectedCardsWhatsApp',null,null,'Opens WhatsApp for the prepared selected-card flow; no canonical share action exists.',
      {status:'unresolved',entity:'card_selection',operation:'share_whatsapp',shadowGate:'pending'}),

    mutation('savePersonDialog','people',['create','update'],'Mode is selected by personDialogId.'),
    mutation('deletePersonFromDatabase','people','delete'),
    mutation('importPeopleExcelFile','people','import'),
    mutation('saveTemplate','templates','create','Conference template, not house template.',
      {entity:'conference_template',operation:'create'}),
    mutation('saveHouseTemplate','templates',['create','update'],'Mode is selected by editHouseTemplateId.',
      {entity:'house_template',operation:'save',discriminator:'editHouseTemplateId'}),
    mutation('deleteHouseTemplate','templates','delete','Deletes an appData.houseTemplates record.',
      {entity:'house_template',operation:'delete'}),
    mutation('duplicateHouseTemplate','templates','create','Duplicates an appData.houseTemplates record.',
      {entity:'house_template',operation:'duplicate'}),
    mutation('moveTemplateToTrash','templates','delete','Moves a conference template to trash.',
      {entity:'conference_template',operation:'move_to_trash'}),
    mutation('saveTemplateFloor','templates',['create','update'],
      'Mutates a floor inside appData.houseTemplates and conditionally updates the linked current-conference accommodation floor.',
      {status:'compound',entity:'house_template_floor',operation:'save_and_conditionally_sync_conference_floor',discriminator:'templateFloorDialog.floorId',shadowGate:'pending'}),
    mutation('saveTemplateRoom','templates',['create','update'],
      'Mutates a room inside appData.houseTemplates.',
      {entity:'house_template_room',operation:'save',discriminator:'templateRoomDialog.roomId',shadowGate:'pending'}),
    mutation('ht_deleteFloorFromTemplate','templates','delete',
      'Deletes a floor from appData.houseTemplates.',
      {entity:'house_template_floor',operation:'delete',shadowGate:'pending'}),
    mutation('ht_deleteRoomFromTemplate','templates','delete',
      'Deletes a room from appData.houseTemplates.',
      {entity:'house_template_room',operation:'delete',shadowGate:'pending'}),

    mutation('addHouse','templates','create','Adds a house to appData.templates[].data.houses.',
      {entity:'conference_template_house',operation:'create',shadowGate:'pending'}),
    mutation('updateHouse','templates','update','Updates a house in appData.templates[].data.houses.',
      {entity:'conference_template_house',operation:'update',shadowGate:'pending'}),
    mutation('removeHouse','templates','delete','Deletes a house from appData.templates[].data.houses.',
      {entity:'conference_template_house',operation:'delete',shadowGate:'pending'}),
    mutation('addFloor','templates','create','Adds a floor to a conference-template house.',
      {entity:'conference_template_floor',operation:'create',shadowGate:'pending'}),
    mutation('updateFloor','templates','update','Updates a floor in a conference-template house.',
      {entity:'conference_template_floor',operation:'update',shadowGate:'pending'}),
    mutation('removeFloor','templates','delete','Deletes a floor from a conference-template house.',
      {entity:'conference_template_floor',operation:'delete',shadowGate:'pending'}),
    mutation('addRoom','templates','create','Adds a room to a conference-template floor.',
      {entity:'conference_template_room',operation:'create',shadowGate:'pending'}),
    mutation('updateRoom','templates','update','Updates a room in a conference-template floor.',
      {entity:'conference_template_room',operation:'update',shadowGate:'pending'}),
    mutation('removeRoom','templates','delete','Deletes a room from a conference-template floor.',
      {entity:'conference_template_room',operation:'delete',shadowGate:'pending'}),

    mutation('saveConferenceBranding',null,null,'Conference branding spans settings and cards presentation.'),
    mutation('clearActivityLog',null,null,'Audit-log deletion needs a dedicated future decision.'),
    mutation('restoreTrashItem',null,null,'Target section depends on the restored item type.',
      {entity:'dynamic_trash_item',operation:'restore',discriminator:'type'}),
    mutation('purgeTrashItem',null,null,'Target section depends on the deleted item type.',
      {entity:'dynamic_trash_item',operation:'purge',discriminator:'type'})
  ]);
  var CONFERENCE_MUTATION_CATALOG=Object.freeze([
    Object.freeze({handler:'loadFromFile',action:null,status:'flow_entry',entity:'conference_file',operation:'select_and_parse',shadowGate:'pending',notes:'Selects and parses a file; importSingleConferenceData performs the mutation.'}),
    Object.freeze({handler:'importSingleConferenceData',action:null,status:'external_prerequisite',entity:'conference',operation:'import_or_replace',shadowGate:'pending',notes:'Adds or replaces a local conference and deliberately deactivates it pending authorization; no canonical conference import action exists.'}),
    Object.freeze({handler:'applyTemplate',action:null,status:'external_prerequisite',entity:'conference',operation:'create_from_conference_template',shadowGate:'pending',notes:'Creates and persists a new conference; account and organization creation authorization is required outside section permissions.'}),
    Object.freeze({handler:'createConferenceFromSelection',action:null,status:'multi_mode',entity:'conference',operation:'create_or_edit_metadata',discriminator:'conferenceDialogMode',shadowGate:'pending',modes:Object.freeze({
      create:Object.freeze({status:'external_prerequisite',action:null,notes:'Conference creation is governed by account and organization authorization outside the 13 Conference actions.'}),
      edit:Object.freeze({status:'classified',action:'conference.edit_metadata',notes:'Updates and persists metadata for the already-authorized current conference.'})
    }),notes:'Mode must be resolved from conferenceDialogMode; currentConferenceId or local presence is not a discriminator.'}),
    Object.freeze({handler:'createNewConference',action:null,status:'flow_entry',notes:'Opens the creation flow and is not an authorization mutation.'}),
    Object.freeze({handler:'editCurrentConference',action:null,status:'flow_entry',entity:'conference',operation:'open_edit_metadata_flow',shadowGate:'phase2b_legacy',notes:'Opens the edit dialog; createConferenceFromSelection performs the mutation in edit mode.'}),
    Object.freeze({handler:'saveSettings',action:'conference.edit_metadata',status:'unresolved',notes:'Also changes accommodation template selection.'}),
    Object.freeze({handler:'completeCurrentConference',action:'conference.complete',status:'classified',notes:''}),
    Object.freeze({handler:'archiveCurrentConference',action:'conference.archive',status:'classified',notes:''}),
    Object.freeze({handler:'restoreArchive',action:'conference.restore_archive',status:'classified',notes:''}),
    Object.freeze({handler:'deleteCurrentConference',action:'conference.delete',status:'classified',notes:''}),
    Object.freeze({handler:'exportJsonFile',action:'conference.export_full',status:'classified',notes:''}),
    Object.freeze({handler:'saveToFile',action:'conference.export_full',status:'classified',notes:''}),
    Object.freeze({handler:'downloadFullApplicationBackup',action:'conference.backup_full',status:'classified',entity:'application_backup',operation:'download_full',shadowGate:null,notes:'Application-wide downloadable backup that may span multiple conferences; it is distinct from creating a stored local backup.'}),
    Object.freeze({handler:'backupAppData',action:'conference.backup_full',status:'classified',entity:'application_backup',operation:'create_local',shadowGate:'pending',notes:'Creates and stores a local application backup; it does not download a file.'}),
    Object.freeze({handler:'moveArchiveToTrash',action:null,status:'unresolved',entity:'conference_archive',operation:'move_to_trash',shadowGate:'pending',notes:'Deletes an archive artifact, not the active conference; conference.delete would change semantics.'}),
    Object.freeze({handler:'moveBackupToTrash',action:null,status:'unresolved',entity:'application_backup',operation:'move_to_trash',shadowGate:'pending',notes:'Deletes a stored backup artifact; no canonical backup-artifact delete action exists.'}),
    Object.freeze({handler:'repairBackupStorageBloat',action:null,status:'unresolved',entity:'application_backup',operation:'maintenance_rewrite',shadowGate:'pending',notes:'Dormant maintenance helper rewrites every stored backup; backup creation permission does not describe this mutation.'}),
    Object.freeze({handler:'executeConfirmedFullRestore',action:'conference.restore_full',status:'classified',notes:'Application-wide restore may span multiple conferences.'}),
    Object.freeze({handler:'restoreBackup',action:'conference.restore_full',status:'classified',notes:'Legacy local backup restore.'})
  ]);
  var FUTURE_ACTION_CANDIDATES=Object.freeze(['share']);
  var SEMANTIC_BOUNDARIES=Object.freeze([
    'account_approval','device_approval','organization_membership',
    'conference_membership','conference_role','section_permission',
    'action_permission','lock_ownership'
  ]);
  var NON_AUTHORIZATION_SIGNALS=Object.freeze([
    'local_presence','currentConferenceId','null_role','lock_ownership',
    'frontend_visibility'
  ]);

  function known(list,value){return typeof value==='string'&&list.indexOf(value)>=0;}
  function hasSectionPermission(role,section,action){
    if(!known(ROLES,role)||!known(SECTIONS,section)||!known(ACTIONS,action))return false;
    var granted=ROLE_BUNDLES[role]&&ROLE_BUNDLES[role].sections[section];
    return Array.isArray(granted)&&granted.indexOf(action)>=0;
  }
  function hasConferencePermission(role,action){
    if(!known(ROLES,role)||!known(CONFERENCE_ACTIONS,action))return false;
    var granted=ROLE_BUNDLES[role]&&ROLE_BUNDLES[role].conference;
    return Array.isArray(granted)&&granted.indexOf(action)>=0;
  }

  global.ConferencePermissionContract=Object.freeze({
    enforcementEnabled:false,
    sections:SECTIONS,actions:ACTIONS,conferenceActions:CONFERENCE_ACTIONS,
    roles:ROLES,roleBundles:ROLE_BUNDLES,mutationCatalog:MUTATION_CATALOG,
    conferenceMutationCatalog:CONFERENCE_MUTATION_CATALOG,
    futureActionCandidates:FUTURE_ACTION_CANDIDATES,
    semanticBoundaries:SEMANTIC_BOUNDARIES,
    nonAuthorizationSignals:NON_AUTHORIZATION_SIGNALS,
    lockSemantics:'concurrency_precondition_only',
    hasSectionPermission:hasSectionPermission,
    hasConferencePermission:hasConferencePermission
  });
})(window);
