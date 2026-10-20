(function(global){
  'use strict';
  var canonicalConference=[
    ['create_canonical_conference','public.create_canonical_conference(uuid,uuid,uuid,text,date,date)'],
    ['mutate_conference_core','public.mutate_conference_core(uuid,uuid,uuid,bigint,text,text,date,date,text)'],
    ['get_conference_core','public.get_conference_core(uuid,uuid)'],
    ['list_accessible_conferences','public.list_accessible_conferences(uuid)'],
    ['list_conference_participations','public.list_conference_participations(uuid,uuid)'],
    ['create_conference_participation','public.create_conference_participation(uuid,uuid,uuid,uuid)'],
    ['create_conference_participation_with_person','public.create_conference_participation_with_person(uuid,uuid,uuid,text,text,text,date,text)'],
    ['search_conference_people','public.search_conference_people(uuid,uuid,text,integer)'],
    ['get_conference_canonical_person','public.get_conference_canonical_person(uuid,uuid,uuid)'],
    ['update_conference_canonical_person','public.update_conference_canonical_person(uuid,uuid,uuid,bigint,text,text,text,text,date)'],
    ['set_conference_participation_status','public.set_conference_participation_status(uuid,uuid,uuid,bigint,text)'],
    ['set_conference_participation_guardian','public.set_conference_participation_guardian(uuid,uuid,uuid,bigint,uuid)'],
    ['delete_conference_participation','public.delete_conference_participation(uuid,uuid,uuid,bigint)'],
    ['list_conference_houses','public.list_conference_houses(uuid)'],
    ['mutate_conference_house_directory','public.mutate_conference_house_directory(uuid,uuid,text,jsonb)'],
    ['assign_conference_house','public.assign_conference_house(uuid,uuid,uuid,uuid,boolean,bigint)'],
    ['get_conference_accommodation','public.get_conference_accommodation(uuid,uuid)'],
    ['assign_conference_accommodation','public.assign_conference_accommodation(uuid,uuid,uuid,uuid,integer,integer,text,text)'],
    ['move_conference_accommodation','public.move_conference_accommodation(uuid,uuid,uuid,bigint,uuid,integer,integer,text,text)'],
    ['remove_conference_accommodation','public.remove_conference_accommodation(uuid,uuid,uuid,bigint)'],
    ['get_conference_transport','public.get_conference_transport(uuid,uuid)'],
    ['mutate_conference_transport_vehicle','public.mutate_conference_transport_vehicle(uuid,uuid,text,uuid,uuid,bigint,text,text,integer,integer,boolean)'],
    ['set_conference_transport_assignment','public.set_conference_transport_assignment(uuid,uuid,uuid,uuid,uuid,text,text,integer,bigint)'],
    ['remove_conference_transport_assignment','public.remove_conference_transport_assignment(uuid,uuid,uuid,bigint)'],
    ['get_conference_restaurant','public.get_conference_restaurant(uuid,uuid)'],
    ['mutate_conference_restaurant','public.mutate_conference_restaurant(uuid,uuid,text,uuid,bigint,jsonb)'],
    ['mutate_conference_accommodation_pricing','public.mutate_conference_accommodation_pricing(uuid,uuid,uuid,bigint,jsonb)'],
    ['get_conference_air_conditioning','public.get_conference_air_conditioning(uuid,uuid)'],
    ['mutate_conference_air_conditioning','public.mutate_conference_air_conditioning(uuid,uuid,uuid,text,uuid,text,bigint,jsonb)'],
    ['get_conference_finance','public.get_conference_finance(uuid,uuid)'],
    ['mutate_conference_finance','public.mutate_conference_finance(uuid,uuid,uuid,text,text,uuid,bigint,jsonb)'],
    ['get_conference_branding','public.get_conference_branding(uuid,uuid)'],
    ['mutate_conference_branding','public.mutate_conference_branding(uuid,uuid,uuid,text,bigint,jsonb)'],
    ['list_conference_activity','public.list_conference_activity(uuid,uuid)'],
    ['record_conference_output_event','public.record_conference_output_event(uuid,uuid,text)']
  ].map(function(entry){return Object.freeze({module:'conference',operation:entry[0],signature:entry[1],dispatchable:true});});
  var platformResourceLeaseOperations=['acquire_resource_lease','renew_resource_lease','release_resource_lease','get_resource_lease'].map(function(operation){return Object.freeze({module:'conference',operation:operation,signature:'platform_private.'+operation+'(uuid,text,text,text,text'+(operation==='get_resource_lease'?'':operation==='release_resource_lease'?',uuid':',uuid,integer')+')',dispatchable:true});});
  var conference=canonicalConference.concat(platformResourceLeaseOperations).concat(global.ConferenceDeviceOperationContract.EDGE_ONLY_PROTECTED.map(function(entry){return Object.freeze({module:'conference',operation:entry.operation,signature:entry.signature,dispatchable:true});}));
  var warehouse=global.WarehouseDeviceOperationContract.DISPATCHABLE;
  global.PlatformDeviceOperationContract=Object.freeze({CONFERENCE:Object.freeze(conference),WAREHOUSE:warehouse,DISPATCHABLE:Object.freeze(conference.concat(warehouse)),isAllowed:function(module,operation){return module==='conference'?conference.some(function(entry){return entry.operation===operation;}):module==='warehouse'&&!!(global.WarehouseDeviceOperationContract.get(operation)||{}).dispatchable;}});
})(window);
