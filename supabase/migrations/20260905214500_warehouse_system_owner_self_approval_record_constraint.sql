alter table warehouse.approval_records
  drop constraint approval_records_check,
  drop constraint approval_records_policy_version_check;

alter table warehouse.approval_records
  add constraint approval_records_check check (
    initiator_user_id<>approver_user_id
    or policy_version='warehouse_approval_policy_v2_system_owner_self_approval'
  ),
  add constraint approval_records_policy_version_check check (
    policy_version in (
      'warehouse_approval_policy_v1',
      'warehouse_approval_policy_v2_system_owner_self_approval'
    )
  );
