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

  function mutation(handler,section,action,notes){
    var actions=Array.isArray(action)?action.slice():action?[action]:[];
    return Object.freeze({
      handler:handler,section:section,action:Object.freeze(actions),
      status:section&&actions.length?'classified':'unresolved',notes:notes||''
    });
  }
  var MUTATION_CATALOG=Object.freeze([
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
    mutation('partialTransferGuest','accommodation','update'),
    mutation('clearConferenceRoom','accommodation','delete','Deletes room occupancy, not the room.'),
    mutation('toggleConferenceRoomClosed','accommodation','update'),
    mutation('deleteConferenceRoom','accommodation','delete'),
    mutation('applyConferenceHouseTemplate','accommodation','import'),
    mutation('importHouseFromTemplate','accommodation','import'),

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

    mutation('printV3Reports','reports','print'),
    mutation('saveV3ReportsPdf','reports','export'),
    mutation('exportV3ReportsExcel','reports','export'),
    mutation('printOne','cards','print'),
    mutation('printSel','cards','print'),
    mutation('downloadCardPng','cards','export'),
    mutation('downloadSelectedCards','cards','export'),
    mutation('shareCard',null,null,'Future action candidate: share.'),
    mutation('shareSelectedCards',null,null,'Future action candidate: share.'),
    mutation('shareSelectedCardsFiles',null,null,'Future action candidate: share.'),

    mutation('savePersonDialog','people',['create','update'],'Mode is selected by personDialogId.'),
    mutation('deletePersonFromDatabase','people','delete'),
    mutation('importPeopleExcelFile','people','import'),
    mutation('saveTemplate','templates','create','Conference template, not house template.'),
    mutation('saveHouseTemplate','templates',['create','update'],'Mode is selected by editHouseTemplateId.'),
    mutation('deleteHouseTemplate','templates','delete'),
    mutation('duplicateHouseTemplate','templates','create'),
    mutation('moveTemplateToTrash','templates','delete'),

    mutation('saveConferenceBranding',null,null,'Conference branding spans settings and cards presentation.'),
    mutation('clearActivityLog',null,null,'Audit-log deletion needs a dedicated future decision.'),
    mutation('restoreTrashItem',null,null,'Target section depends on the restored item type.'),
    mutation('purgeTrashItem',null,null,'Target section depends on the deleted item type.')
  ]);
  var CONFERENCE_MUTATION_CATALOG=Object.freeze([
    Object.freeze({handler:'createConferenceFromSelection',action:null,status:'external_prerequisite',notes:'Final creation mutation is governed outside the 13 Conference membership actions by account and organization authorization.'}),
    Object.freeze({handler:'createNewConference',action:null,status:'flow_entry',notes:'Opens the creation flow and is not an authorization mutation.'}),
    Object.freeze({handler:'editCurrentConference',action:'conference.edit_metadata',status:'classified',notes:''}),
    Object.freeze({handler:'saveSettings',action:'conference.edit_metadata',status:'unresolved',notes:'Also changes accommodation template selection.'}),
    Object.freeze({handler:'completeCurrentConference',action:'conference.complete',status:'classified',notes:''}),
    Object.freeze({handler:'archiveCurrentConference',action:'conference.archive',status:'classified',notes:''}),
    Object.freeze({handler:'restoreArchive',action:'conference.restore_archive',status:'classified',notes:''}),
    Object.freeze({handler:'deleteCurrentConference',action:'conference.delete',status:'classified',notes:''}),
    Object.freeze({handler:'exportJsonFile',action:'conference.export_full',status:'classified',notes:''}),
    Object.freeze({handler:'saveToFile',action:'conference.export_full',status:'classified',notes:''}),
    Object.freeze({handler:'downloadFullApplicationBackup',action:'conference.backup_full',status:'classified',notes:'Application-wide backup may span multiple conferences.'}),
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
