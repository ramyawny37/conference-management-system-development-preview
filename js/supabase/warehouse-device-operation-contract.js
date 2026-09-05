(function(global){
  'use strict';
  var rows=[
    ['discover_parties','warehouse.discover_parties(uuid,text,boolean)','read',['p_role','p_include_inactive'],false,false,'global',true],
    ['get_beneficiary_balance','warehouse.get_beneficiary_balance(uuid,uuid)','read',['p_party_id'],false,false,'global',true],
    ['create_party','warehouse.create_party(uuid,uuid,jsonb)','mutation',['p_operation_id','p_payload'],true,false,'global',true],
    ['update_party','warehouse.update_party(uuid,uuid,uuid,bigint,jsonb)','mutation',['p_operation_id','p_party_id','p_expected_revision','p_payload'],true,true,'global',true],
    ['list_stores','warehouse.list_stores(uuid,uuid)','read',['p_store_id'],false,false,'optional_store',true],
    ['list_item_master','warehouse.list_item_master(uuid)','read',[],false,false,'none',true],
    ['view_stock','warehouse.view_stock(uuid,uuid)','read',['p_store_id'],false,false,'required_store',true],
    ['discover_stores','warehouse.discover_stores(uuid,boolean)','read',['p_include_inactive'],false,false,'discoverable_store',true],
    ['list_documents','warehouse.list_documents(uuid,text,uuid,text,timestamptz,uuid,integer)','read',['p_document_kind','p_store_id','p_status','p_before_created_at','p_before_id','p_limit'],false,false,'optional_store',true],
    ['get_document','warehouse.get_document(uuid,uuid)','read',['p_document_id'],false,false,'document_store',true],
    ['list_approval_queue','warehouse.list_approval_queue(uuid,timestamptz,uuid,integer)','read',['p_before_created_at','p_before_id','p_limit'],false,false,'permission_scoped',true],
    ['list_reversal_requests','warehouse.list_reversal_requests(uuid,text,timestamptz,uuid,integer)','read',['p_status','p_before_created_at','p_before_id','p_limit'],false,false,'permission_scoped',true],
    ['list_history','warehouse.list_history(uuid,uuid,uuid,uuid,text,timestamptz,timestamptz,bigint,integer)','read',['p_store_id','p_document_id','p_item_id','p_document_kind','p_from','p_to','p_before_sequence','p_limit'],false,false,'required_store',true],
    ['list_balances','warehouse.list_balances(uuid,uuid,uuid,integer)','read',['p_store_id','p_before_item_id','p_limit'],false,false,'required_store',true],
    ['create_store','warehouse.create_store(uuid,uuid,text,text,text,text)','mutation',['p_operation_id','p_name','p_type','p_address','p_notes'],true,false,'global',true],
    ['update_store','warehouse.update_store(uuid,uuid,uuid,bigint,text,text,text,text,text)','mutation',['p_operation_id','p_store_id','p_expected_revision','p_name','p_type','p_address','p_status','p_notes'],true,true,'required_store',true],
    ['upsert_item_master','warehouse.upsert_item_master(uuid,uuid,text,uuid,bigint,jsonb)','mutation',['p_operation_id','p_entity_kind','p_entity_id','p_expected_revision','p_payload'],true,true,'global',true],
    ['upsert_item_units','warehouse.upsert_item_units(uuid,uuid,uuid,bigint,jsonb)','mutation',['p_operation_id','p_item_id','p_expected_revision','p_units'],true,true,'global',true],
    ['create_receipt_draft','warehouse.create_receipt_draft(uuid,uuid,jsonb)','mutation',['p_operation_id','p_payload'],true,false,'payload_store',true],
    ['create_issue_draft','warehouse.create_issue_draft(uuid,uuid,jsonb)','mutation',['p_operation_id','p_payload'],true,false,'payload_store',true],
    ['create_transfer_draft','warehouse.create_transfer_draft(uuid,uuid,jsonb)','mutation',['p_operation_id','p_payload'],true,false,'payload_store',true],
    ['create_adjustment_draft','warehouse.create_adjustment_draft(uuid,uuid,text,jsonb)','mutation',['p_operation_id','p_adjustment_kind','p_payload'],true,false,'payload_store',true],
    ['update_document_draft','warehouse.update_document_draft(uuid,uuid,text,uuid,bigint,jsonb)','mutation',['p_operation_id','p_document_kind','p_document_id','p_expected_revision','p_payload'],true,true,'document_store',true],
    ['cancel_document_draft','warehouse.cancel_document_draft(uuid,uuid,text,uuid,bigint,text)','mutation',['p_operation_id','p_document_kind','p_document_id','p_expected_revision','p_reason'],true,true,'document_store',true],
    ['submit_adjustment_for_approval','warehouse.submit_adjustment_for_approval(uuid,uuid,uuid,bigint)','mutation',['p_operation_id','p_document_id','p_expected_revision'],true,true,'document_store',true],
    ['decide_adjustment_approval','warehouse.decide_adjustment_approval(uuid,uuid,uuid,bigint,text,text)','mutation',['p_operation_id','p_document_id','p_expected_revision','p_decision','p_reason'],true,true,'document_store',true],
    ['post_receipt','warehouse.post_receipt(uuid,uuid,uuid,bigint)','mutation',['p_operation_id','p_document_id','p_expected_revision'],true,true,'document_store',true],
    ['post_issue','warehouse.post_issue(uuid,uuid,uuid,bigint)','mutation',['p_operation_id','p_document_id','p_expected_revision'],true,true,'document_store',true],
    ['post_transfer','warehouse.post_transfer(uuid,uuid,uuid,bigint)','mutation',['p_operation_id','p_document_id','p_expected_revision'],true,true,'document_store',true],
    ['post_adjustment','warehouse.post_adjustment(uuid,uuid,uuid,bigint)','mutation',['p_operation_id','p_document_id','p_expected_revision'],true,true,'document_store',true],
    ['create_reversal_request','warehouse.create_reversal_request(uuid,uuid,uuid,text)','mutation',['p_operation_id','p_original_document_id','p_reason'],true,false,'document_store',true],
    ['submit_reversal_request','warehouse.submit_reversal_request(uuid,uuid,uuid,bigint,text)','mutation',['p_operation_id','p_request_id','p_expected_revision','p_reason'],true,true,'request_store',true],
    ['decide_reversal_approval','warehouse.decide_reversal_approval(uuid,uuid,uuid,bigint,text,text)','mutation',['p_operation_id','p_request_id','p_expected_revision','p_decision','p_reason'],true,true,'request_store',true],
    ['post_reversal','warehouse.post_reversal(uuid,uuid,uuid,bigint)','mutation',['p_operation_id','p_request_id','p_expected_revision'],true,true,'request_store',true],
    ['authorize_report_export','warehouse.authorize_report_export(uuid,uuid)','mutation',['p_store_id'],false,false,'required_store',true],
    ['stage_import','warehouse.stage_import(uuid,uuid,jsonb)','mutation',['p_operation_id','p_manifest'],true,false,'manifest_store',false]
  ];
  var entries=rows.map(function(row){return Object.freeze({module:'warehouse',operation:row[0],schema:'warehouse',functionName:row[0],signature:row[1],kind:row[2],requiredArguments:Object.freeze(row[3]),operationIdRequired:row[4],revisionRequired:row[5],storeScope:row[6],dispatchable:row[7]});});
  var map=Object.create(null);entries.forEach(function(entry){map[entry.operation]=entry;});
  global.WarehouseDeviceOperationContract=Object.freeze({PROTECTED:Object.freeze(entries),DISPATCHABLE:Object.freeze(entries.filter(function(entry){return entry.dispatchable;})),DEFERRED:Object.freeze(entries.filter(function(entry){return !entry.dispatchable;})),get:function(operation){return map[String(operation||'')]||null;}});
})(window);
