begin;

-- Phase A only: inert WebAuthn security schema. No browser-callable
-- enrollment, verification, listing, approval, rejection, or recovery RPCs.
create table public.webauthn_privileged_device_feature (
  singleton_id smallint primary key default 1 check (singleton_id=1),
  enabled boolean not null default false check (enabled=false),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.webauthn_privileged_device_feature(singleton_id,enabled)
values(1,false);

create table public.device_security_credentials (
  id uuid primary key default gen_random_uuid(),
  webauthn_credential_id bytea not null unique
    check (octet_length(webauthn_credential_id) between 16 and 1024),
  user_id uuid not null references auth.users(id) on delete restrict,
  device_id uuid not null,
  credential_kind text not null check (
    credential_kind in ('platform_primary','recovery_security_key')),
  public_key_cose bytea not null check (octet_length(public_key_cose)>0),
  public_key_algorithm integer not null check (public_key_algorithm<0),
  aaguid uuid null,
  transports text[] not null default '{}'::text[],
  sign_count bigint not null default 0 check (sign_count>=0),
  backup_eligible boolean not null,
  backup_state boolean not null,
  user_verification_policy text not null check (
    user_verification_policy='required'),
  lifecycle_status text not null check (lifecycle_status in (
    'enrollment_pending','active','rotation_pending','revoked','recovery_required')),
  created_at timestamptz not null default now(),
  enrolled_at timestamptz null,
  activated_at timestamptz null,
  last_used_at timestamptz null,
  revoked_at timestamptz null,
  revoked_by uuid null references auth.users(id) on delete set null,
  revocation_reason text null,
  constraint device_security_credentials_authorization_fk
    foreign key(user_id,device_id)
    references public.user_device_authorizations(user_id,device_id)
    on delete restrict,
  constraint device_security_credentials_identity_unique
    unique(id,user_id,device_id),
  constraint device_security_credentials_user_identity_unique
    unique(id,user_id),
  constraint device_security_credentials_non_backup_policy
    check (backup_eligible=false and backup_state=false),
  constraint device_security_credentials_lifecycle_timestamps
    check (
      (lifecycle_status='enrollment_pending'
        and enrolled_at is null and activated_at is null and revoked_at is null)
      or
      (lifecycle_status in ('active','rotation_pending','recovery_required')
        and enrolled_at is not null and activated_at is not null and revoked_at is null)
      or
      (lifecycle_status='revoked' and revoked_at is not null)
    ),
  constraint device_security_credentials_revocation_context
    check (
      (revoked_at is null and revoked_by is null and revocation_reason is null)
      or
      (revoked_at is not null and revocation_reason is not null
        and length(btrim(revocation_reason)) between 1 and 500)
    ),
  constraint device_security_credentials_timestamp_order
    check (
      (enrolled_at is null or enrolled_at>=created_at)
      and (activated_at is null or (enrolled_at is not null and activated_at>=enrolled_at))
      and (last_used_at is null or last_used_at>=created_at)
      and (revoked_at is null or revoked_at>=created_at)
    )
);

create unique index device_security_credentials_active_primary_idx
  on public.device_security_credentials(user_id,device_id)
  where credential_kind='platform_primary' and lifecycle_status='active';

create table public.device_possession_challenges (
  id uuid primary key default gen_random_uuid(),
  challenge_hash bytea not null unique check (octet_length(challenge_hash)=32),
  user_id uuid not null references auth.users(id) on delete restrict,
  session_id uuid not null,
  actor_device_id uuid not null,
  credential_id uuid null,
  purpose text not null check (purpose in (
    'SYSTEM_OWNER_PENDING_DEVICE_LIST',
    'SYSTEM_OWNER_PENDING_DEVICE_APPROVE',
    'SYSTEM_OWNER_PENDING_DEVICE_REJECT',
    'SYSTEM_OWNER_DEVICE_REVOKE',
    'SYSTEM_OWNER_DEVICE_REPLACEMENT',
    'SYSTEM_OWNER_CREDENTIAL_ENROLLMENT',
    'SYSTEM_OWNER_CREDENTIAL_ROTATION',
    'SYSTEM_OWNER_CREDENTIAL_RECOVERY')),
  target_user_id uuid null references auth.users(id) on delete restrict,
  target_device_id uuid null,
  replaced_device_id uuid null,
  replacement_device_id uuid null,
  operation_id uuid null,
  expected_origin text not null check (
    expected_origin=lower(expected_origin)
    and expected_origin ~ '^https://[^/]+$|^http://localhost(:[0-9]+)?$'),
  expected_rp_id text not null check (
    expected_rp_id=lower(expected_rp_id)
    and expected_rp_id ~ '^[a-z0-9.-]+$'),
  environment text not null check (
    environment in ('local','development_preview','production')),
  expires_at timestamptz not null,
  verified_at timestamptz null,
  consumed_at timestamptz null,
  failed_at timestamptz null,
  failure_code text null,
  created_at timestamptz not null default now(),
  verification_context jsonb null default null
    check (verification_context is null or jsonb_typeof(verification_context)='object'),
  constraint device_possession_challenges_actor_authorization_fk
    foreign key(user_id,actor_device_id)
    references public.user_device_authorizations(user_id,device_id)
    on delete restrict,
  constraint device_possession_challenges_credential_fk
    foreign key(credential_id,user_id,actor_device_id)
    references public.device_security_credentials(id,user_id,device_id)
    on delete restrict,
  constraint device_possession_challenges_target_authorization_fk
    foreign key(target_user_id,target_device_id)
    references public.user_device_authorizations(user_id,device_id)
    on delete restrict,
  constraint device_possession_challenges_replaced_authorization_fk
    foreign key(target_user_id,replaced_device_id)
    references public.user_device_authorizations(user_id,device_id)
    on delete restrict,
  constraint device_possession_challenges_replacement_authorization_fk
    foreign key(target_user_id,replacement_device_id)
    references public.user_device_authorizations(user_id,device_id)
    on delete restrict,
  constraint device_possession_challenges_identity_unique
    unique(id,user_id,actor_device_id,credential_id),
  constraint device_possession_challenges_listing_identity_unique
    unique(id,user_id,session_id,actor_device_id,credential_id,purpose),
  constraint device_possession_challenges_purpose_identity_unique
    unique(id,purpose),
  constraint device_possession_challenges_operation_actor_unique
    unique(id,user_id,session_id,actor_device_id,credential_id,purpose,environment,operation_id),
  constraint device_possession_challenges_audit_actor_unique
    unique(id,user_id,session_id,actor_device_id,credential_id,purpose,environment),
  constraint device_possession_challenges_audit_base_unique
    unique(id,user_id,session_id,actor_device_id,purpose,environment),
  constraint device_possession_challenges_audit_credential_unique
    unique(id,credential_id),
  constraint device_possession_challenges_audit_operation_unique
    unique(id,operation_id),
  constraint device_possession_challenges_operation_target_unique
    unique(id,target_user_id,target_device_id),
  constraint device_possession_challenges_operation_replacement_unique
    unique(id,target_user_id,replaced_device_id,replacement_device_id),
  constraint device_possession_challenges_expiration
    check (expires_at>created_at and expires_at<=created_at+interval '2 minutes'),
  constraint device_possession_challenges_lifecycle
    check (
      (consumed_at is null or (verified_at is not null and consumed_at>=verified_at))
      and (failed_at is null or consumed_at is null)
      and (failure_code is null)=(failed_at is null)
      and (verified_at is null or verified_at>=created_at)
      and (failed_at is null or failed_at>=created_at)
      and ((verified_at is null and verification_context is null)
        or (verified_at is not null and verification_context is not null
          and verification_context<>'{}'::jsonb))
    ),
  constraint device_possession_challenges_purpose_binding
    check (
      (purpose='SYSTEM_OWNER_PENDING_DEVICE_LIST'
        and credential_id is not null and target_user_id is null
        and target_device_id is null and replaced_device_id is null
        and replacement_device_id is null and operation_id is null)
      or
      (purpose in ('SYSTEM_OWNER_PENDING_DEVICE_APPROVE',
        'SYSTEM_OWNER_PENDING_DEVICE_REJECT','SYSTEM_OWNER_DEVICE_REVOKE')
        and credential_id is not null and target_user_id is not null
        and target_device_id is not null and replaced_device_id is null
        and replacement_device_id is null and operation_id is not null)
      or
      (purpose='SYSTEM_OWNER_DEVICE_REPLACEMENT'
        and credential_id is not null and target_user_id is not null
        and target_device_id is null and replaced_device_id is not null
        and replacement_device_id is not null
        and replaced_device_id<>replacement_device_id and operation_id is not null)
      or
      (purpose='SYSTEM_OWNER_CREDENTIAL_ENROLLMENT'
        and credential_id is null and target_user_id is null
        and target_device_id is null and replaced_device_id is null
        and replacement_device_id is null and operation_id is not null)
      or
      (purpose in ('SYSTEM_OWNER_CREDENTIAL_ROTATION',
        'SYSTEM_OWNER_CREDENTIAL_RECOVERY')
        and target_user_id is not null and target_device_id is not null
        and replaced_device_id is null and replacement_device_id is null
        and operation_id is not null)
    )
);

create index device_possession_challenges_expiry_idx
  on public.device_possession_challenges(expires_at)
  where consumed_at is null and failed_at is null;

-- One backend-only consumer registry row per challenge. Phase B/D completion
-- transactions must insert this row and consume the challenge atomically.
create table public.device_possession_challenge_consumers (
  challenge_id uuid primary key,
  user_id uuid not null,
  session_id uuid not null,
  actor_device_id uuid not null,
  actor_credential_id uuid null,
  challenge_purpose text not null,
  environment text not null check (
    environment in ('local','development_preview','production')),
  consumer_kind text not null check (consumer_kind in (
    'listing_session','device_authorization_operation','credential_enrollment',
    'credential_rotation','credential_recovery')),
  consumer_id uuid not null unique,
  registered_at timestamptz not null default now(),
  constraint device_possession_challenge_consumers_identity_unique
    unique(challenge_id,user_id,session_id,actor_device_id,actor_credential_id,
      challenge_purpose,environment,consumer_id,consumer_kind),
  constraint device_possession_challenge_consumers_challenge_actor_fk
    foreign key(challenge_id,user_id,session_id,actor_device_id,
      challenge_purpose,environment)
    references public.device_possession_challenges(
      id,user_id,session_id,actor_device_id,purpose,environment)
    on delete restrict,
  constraint device_possession_challenge_consumers_challenge_credential_fk
    foreign key(challenge_id,actor_credential_id)
    references public.device_possession_challenges(id,credential_id)
    on delete restrict,
  constraint device_possession_challenge_consumers_purpose_kind
    check (
      (challenge_purpose='SYSTEM_OWNER_PENDING_DEVICE_LIST'
        and consumer_kind='listing_session' and actor_credential_id is not null)
      or (challenge_purpose in ('SYSTEM_OWNER_PENDING_DEVICE_APPROVE',
        'SYSTEM_OWNER_PENDING_DEVICE_REJECT','SYSTEM_OWNER_DEVICE_REVOKE',
        'SYSTEM_OWNER_DEVICE_REPLACEMENT')
        and consumer_kind='device_authorization_operation'
        and actor_credential_id is not null)
      or (challenge_purpose='SYSTEM_OWNER_CREDENTIAL_ENROLLMENT'
        and consumer_kind='credential_enrollment' and actor_credential_id is null)
      or (challenge_purpose='SYSTEM_OWNER_CREDENTIAL_ROTATION'
        and consumer_kind='credential_rotation' and actor_credential_id is not null)
      or (challenge_purpose='SYSTEM_OWNER_CREDENTIAL_RECOVERY'
        and consumer_kind='credential_recovery')
    )
);

create table public.privileged_device_listing_sessions (
  id uuid primary key default gen_random_uuid(),
  opaque_token_hash bytea not null unique check (octet_length(opaque_token_hash)=32),
  user_id uuid not null references auth.users(id) on delete restrict,
  session_id uuid not null,
  actor_device_id uuid not null,
  credential_id uuid not null,
  source_challenge_id uuid not null unique,
  source_challenge_purpose text not null
    check (source_challenge_purpose='SYSTEM_OWNER_PENDING_DEVICE_LIST'),
  environment text not null check (
    environment in ('local','development_preview','production')),
  consumer_kind text not null default 'listing_session'
    check (consumer_kind='listing_session'),
  scope text not null check (scope='SYSTEM_OWNER_PENDING_DEVICE_LIST_READ_ONLY'),
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz null,
  constraint privileged_device_listing_sessions_credential_fk
    foreign key(credential_id,user_id,actor_device_id)
    references public.device_security_credentials(id,user_id,device_id)
    on delete restrict,
  constraint privileged_device_listing_sessions_challenge_fk
    foreign key(source_challenge_id,user_id,session_id,actor_device_id,
      credential_id,source_challenge_purpose,environment)
    references public.device_possession_challenges(
      id,user_id,session_id,actor_device_id,credential_id,purpose,environment)
    on delete restrict,
  constraint privileged_device_listing_sessions_consumer_fk
    foreign key(source_challenge_id,user_id,session_id,actor_device_id,credential_id,
      source_challenge_purpose,environment,id,consumer_kind)
    references public.device_possession_challenge_consumers(
      challenge_id,user_id,session_id,actor_device_id,actor_credential_id,
      challenge_purpose,environment,consumer_id,consumer_kind)
    on delete restrict,
  constraint privileged_device_listing_sessions_expiration
    check (expires_at>issued_at and expires_at<=issued_at+interval '5 minutes'),
  constraint privileged_device_listing_sessions_revocation
    check (revoked_at is null or revoked_at>=issued_at)
);

create table public.privileged_device_authorization_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid null references auth.users(id) on delete set null,
  actor_user_id_snapshot uuid not null,
  actor_device_id uuid not null,
  actor_credential_id uuid null,
  session_id_hash bytea not null check (octet_length(session_id_hash)=32),
  session_id uuid null,
  challenge_id uuid null references public.device_possession_challenges(id) on delete restrict,
  challenge_purpose text null,
  environment text not null check (
    environment in ('local','development_preview','production')),
  target_user_id uuid null references auth.users(id) on delete set null,
  target_user_id_snapshot uuid null,
  target_device_id uuid null,
  challenge_target_user_id uuid null,
  challenge_target_device_id uuid null,
  replaced_device_id uuid null,
  replacement_device_id uuid null,
  action text not null check (action in (
    'credential_bootstrap_authorization_issued',
    'credential_recovery_authorization_issued',
    'credential_enrolled','credential_activated','credential_revoked',
    'pending_device_listed','pending_device_approved','pending_device_rejected',
    'device_revoked','device_replaced')),
  operation_id uuid null,
  result text not null check (result in ('issued','verified','applied','rejected','failed','revoked')),
  origin text not null,
  rp_id text not null,
  user_verified boolean not null,
  backup_eligible boolean not null,
  backup_state boolean not null,
  created_at timestamptz not null default now(),
  security_context jsonb not null default '{}'::jsonb
    check (jsonb_typeof(security_context)='object'),
  constraint privileged_device_audit_actor_authorization_fk
    foreign key(actor_user_id_snapshot,actor_device_id)
    references public.user_device_authorizations(user_id,device_id)
    on delete restrict,
  constraint privileged_device_audit_actor_credential_fk
    foreign key(actor_credential_id,actor_user_id_snapshot,actor_device_id)
    references public.device_security_credentials(id,user_id,device_id)
    on delete restrict,
  constraint privileged_device_audit_challenge_actor_fk
    foreign key(challenge_id,actor_user_id_snapshot,session_id,actor_device_id,
      challenge_purpose,environment)
    references public.device_possession_challenges(
      id,user_id,session_id,actor_device_id,purpose,environment)
    on delete restrict,
  constraint privileged_device_audit_challenge_credential_fk
    foreign key(challenge_id,actor_credential_id)
    references public.device_possession_challenges(id,credential_id)
    on delete restrict,
  constraint privileged_device_audit_challenge_operation_fk
    foreign key(challenge_id,operation_id)
    references public.device_possession_challenges(id,operation_id)
    on delete restrict,
  constraint privileged_device_audit_challenge_target_fk
    foreign key(challenge_id,challenge_target_user_id,challenge_target_device_id)
    references public.device_possession_challenges(id,target_user_id,target_device_id)
    on delete restrict,
  constraint privileged_device_audit_challenge_replacement_fk
    foreign key(challenge_id,target_user_id_snapshot,replaced_device_id,replacement_device_id)
    references public.device_possession_challenges(
      id,target_user_id,replaced_device_id,replacement_device_id)
    on delete restrict,
  constraint privileged_device_audit_target_authorization_fk
    foreign key(target_user_id_snapshot,target_device_id)
    references public.user_device_authorizations(user_id,device_id)
    on delete restrict,
  constraint privileged_device_audit_replaced_authorization_fk
    foreign key(target_user_id_snapshot,replaced_device_id)
    references public.user_device_authorizations(user_id,device_id)
    on delete restrict,
  constraint privileged_device_audit_replacement_authorization_fk
    foreign key(target_user_id_snapshot,replacement_device_id)
    references public.user_device_authorizations(user_id,device_id)
    on delete restrict,
  constraint privileged_device_audit_target_shape
    check (
      (action='device_replaced' and target_device_id is null
        and target_user_id_snapshot is not null
        and replaced_device_id is not null and replacement_device_id is not null
        and replaced_device_id<>replacement_device_id)
      or
      (action='pending_device_listed' and target_user_id_snapshot is null
        and target_device_id is null and replaced_device_id is null
        and replacement_device_id is null)
      or
      (action not in ('device_replaced','pending_device_listed')
        and target_user_id_snapshot is not null and target_device_id is not null
        and replaced_device_id is null and replacement_device_id is null)
    ),
  constraint privileged_device_audit_webauthn_policy
    check (
      (action in ('credential_bootstrap_authorization_issued',
        'credential_recovery_authorization_issued')
        and actor_credential_id is null and challenge_id is null
        and session_id is null and challenge_purpose is null
        and operation_id is null and challenge_target_user_id is null
        and challenge_target_device_id is null)
      or
      (action not in ('credential_bootstrap_authorization_issued',
        'credential_recovery_authorization_issued')
        and challenge_id is not null
        and session_id is not null and challenge_purpose is not null
        and (actor_credential_id is not null
          or (action='credential_enrolled'
            and challenge_purpose='SYSTEM_OWNER_CREDENTIAL_ENROLLMENT'))
        and user_verified=true and backup_eligible=false and backup_state=false)
    ),
  constraint privileged_device_audit_action_purpose
    check (
      action in ('credential_bootstrap_authorization_issued',
        'credential_recovery_authorization_issued')
      or (action='pending_device_listed'
        and challenge_purpose='SYSTEM_OWNER_PENDING_DEVICE_LIST'
        and operation_id is null and target_user_id_snapshot is null
        and target_device_id is null and challenge_target_user_id is null
        and challenge_target_device_id is null)
      or (action='pending_device_approved'
        and challenge_purpose='SYSTEM_OWNER_PENDING_DEVICE_APPROVE'
        and operation_id is not null
        and challenge_target_user_id is not null
        and challenge_target_device_id is not null
        and challenge_target_user_id=target_user_id_snapshot
        and challenge_target_device_id=target_device_id)
      or (action='pending_device_rejected'
        and challenge_purpose='SYSTEM_OWNER_PENDING_DEVICE_REJECT'
        and operation_id is not null
        and challenge_target_user_id is not null
        and challenge_target_device_id is not null
        and challenge_target_user_id=target_user_id_snapshot
        and challenge_target_device_id=target_device_id)
      or (action='device_revoked'
        and challenge_purpose='SYSTEM_OWNER_DEVICE_REVOKE'
        and operation_id is not null
        and challenge_target_user_id is not null
        and challenge_target_device_id is not null
        and challenge_target_user_id=target_user_id_snapshot
        and challenge_target_device_id=target_device_id)
      or (action='device_replaced'
        and challenge_purpose='SYSTEM_OWNER_DEVICE_REPLACEMENT'
        and operation_id is not null and challenge_target_user_id is null
        and challenge_target_device_id is null)
      or (action='credential_enrolled'
        and challenge_purpose='SYSTEM_OWNER_CREDENTIAL_ENROLLMENT'
        and operation_id is not null
        and challenge_target_user_id is null and challenge_target_device_id is null
        and target_user_id_snapshot=actor_user_id_snapshot
        and target_device_id=actor_device_id)
      or (action='credential_activated'
        and challenge_purpose in ('SYSTEM_OWNER_CREDENTIAL_ROTATION',
          'SYSTEM_OWNER_CREDENTIAL_RECOVERY') and operation_id is not null
        and challenge_target_user_id is not null
        and challenge_target_device_id is not null
        and challenge_target_user_id=target_user_id_snapshot
        and challenge_target_device_id=target_device_id)
      or (action='credential_revoked'
        and challenge_purpose in ('SYSTEM_OWNER_CREDENTIAL_ROTATION',
          'SYSTEM_OWNER_CREDENTIAL_RECOVERY') and operation_id is not null
        and challenge_target_user_id is not null
        and challenge_target_device_id is not null
        and challenge_target_user_id=target_user_id_snapshot
        and challenge_target_device_id=target_device_id)
    ),
  constraint privileged_device_audit_live_snapshot_consistency
    check ((actor_user_id is null or actor_user_id=actor_user_id_snapshot)
      and (target_user_id is null or target_user_id=target_user_id_snapshot))
);

create table public.system_owner_credential_bootstrap_authorizations (
  id uuid primary key default gen_random_uuid(),
  authorization_hash bytea not null unique check (octet_length(authorization_hash)=32),
  intended_user_id uuid not null references auth.users(id) on delete restrict,
  intended_device_id uuid not null,
  environment text not null check (
    environment in ('local','development_preview','production')),
  purpose text not null default 'SYSTEM_OWNER_CREDENTIAL_ENROLLMENT'
    check (purpose='SYSTEM_OWNER_CREDENTIAL_ENROLLMENT'),
  intended_device_authorization_status text not null
    check (intended_device_authorization_status='approved'),
  intended_device_revoked_at timestamptz null
    check (intended_device_revoked_at is null),
  intended_user_system_owner boolean not null
    check (intended_user_system_owner=true),
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz null,
  operator_user_id uuid not null references auth.users(id) on delete restrict,
  reason text not null check (length(btrim(reason)) between 1 and 500),
  issuance_audit_id uuid not null unique
    references public.privileged_device_authorization_audit_log(id) on delete restrict,
  constraint system_owner_credential_bootstrap_device_fk
    foreign key(intended_user_id,intended_device_id)
    references public.user_device_authorizations(user_id,device_id)
    on delete restrict,
  constraint system_owner_credential_bootstrap_expiration
    check (expires_at>issued_at),
  constraint system_owner_credential_bootstrap_consumption
    check (consumed_at is null or (consumed_at>=issued_at and consumed_at<=expires_at))
);

create table public.system_owner_credential_recovery_authorizations (
  id uuid primary key default gen_random_uuid(),
  intended_user_id uuid not null references auth.users(id) on delete restrict,
  intended_device_id uuid not null,
  authorizing_credential_id uuid null
    references public.device_security_credentials(id) on delete restrict,
  operator_user_id uuid null references auth.users(id) on delete restrict,
  recovery_method text not null check (recovery_method in (
    'active_platform_credential','recovery_security_key','controlled_operator')),
  environment text not null check (
    environment in ('local','development_preview','production')),
  issued_at timestamptz not null default now(),
  not_before timestamptz not null,
  expires_at timestamptz not null,
  consumed_at timestamptz null,
  status text not null check (status in (
    'pending_wait','ready','consumed','revoked','expired')),
  reason text not null check (length(btrim(reason)) between 1 and 500),
  issuance_audit_id uuid not null unique
    references public.privileged_device_authorization_audit_log(id) on delete restrict,
  constraint system_owner_credential_recovery_device_fk
    foreign key(intended_user_id,intended_device_id)
    references public.user_device_authorizations(user_id,device_id)
    on delete restrict,
  constraint system_owner_credential_recovery_credential_user_fk
    foreign key(authorizing_credential_id,intended_user_id)
    references public.device_security_credentials(id,user_id)
    on delete restrict,
  constraint system_owner_credential_recovery_authority
    check (
      (recovery_method in ('active_platform_credential','recovery_security_key')
        and authorizing_credential_id is not null and operator_user_id is null)
      or
      (recovery_method='controlled_operator'
        and authorizing_credential_id is null and operator_user_id is not null)
    ),
  constraint system_owner_credential_recovery_timing
    check (not_before>=issued_at and expires_at>not_before),
  constraint system_owner_credential_recovery_consumption
    check (
      (status='consumed' and consumed_at is not null
        and consumed_at>=not_before and consumed_at<=expires_at)
      or
      (status<>'consumed' and consumed_at is null)
    )
);

create table public.system_owner_device_authorization_operations (
  operation_id uuid primary key,
  actor_user_id uuid null references auth.users(id) on delete set null,
  actor_user_id_snapshot uuid not null,
  actor_device_id uuid not null,
  actor_credential_id uuid not null
    references public.device_security_credentials(id) on delete restrict,
  challenge_id uuid not null unique
    references public.device_possession_challenges(id) on delete restrict,
  session_id uuid not null,
  challenge_purpose text not null,
  environment text not null check (
    environment in ('local','development_preview','production')),
  consumer_kind text not null default 'device_authorization_operation'
    check (consumer_kind='device_authorization_operation'),
  target_user_id uuid null references auth.users(id) on delete set null,
  target_user_id_snapshot uuid not null,
  target_device_id uuid null,
  replaced_device_id uuid null,
  replacement_device_id uuid null,
  action text not null check (action in (
    'approve_system_owner_pending_device','reject_system_owner_pending_device',
    'revoke_system_owner_device','replace_system_owner_device')),
  outcome text not null check (outcome in ('applied','unchanged','rejected')),
  stored_result jsonb not null check (jsonb_typeof(stored_result)='object'),
  created_at timestamptz not null default now(),
  constraint system_owner_device_operations_actor_authorization_fk
    foreign key(actor_user_id_snapshot,actor_device_id)
    references public.user_device_authorizations(user_id,device_id)
    on delete restrict,
  constraint system_owner_device_operations_actor_credential_fk
    foreign key(actor_credential_id,actor_user_id_snapshot,actor_device_id)
    references public.device_security_credentials(id,user_id,device_id)
    on delete restrict,
  constraint system_owner_device_operations_target_authorization_fk
    foreign key(target_user_id_snapshot,target_device_id)
    references public.user_device_authorizations(user_id,device_id)
    on delete restrict,
  constraint system_owner_device_operations_replaced_authorization_fk
    foreign key(target_user_id_snapshot,replaced_device_id)
    references public.user_device_authorizations(user_id,device_id)
    on delete restrict,
  constraint system_owner_device_operations_replacement_authorization_fk
    foreign key(target_user_id_snapshot,replacement_device_id)
    references public.user_device_authorizations(user_id,device_id)
    on delete restrict,
  constraint system_owner_device_operations_challenge_actor_fk
    foreign key(challenge_id,actor_user_id_snapshot,session_id,actor_device_id,
      actor_credential_id,challenge_purpose,environment,operation_id)
    references public.device_possession_challenges(
      id,user_id,session_id,actor_device_id,credential_id,purpose,environment,operation_id)
    on delete restrict,
  constraint system_owner_device_operations_challenge_target_fk
    foreign key(challenge_id,target_user_id_snapshot,target_device_id)
    references public.device_possession_challenges(id,target_user_id,target_device_id)
    on delete restrict,
  constraint system_owner_device_operations_challenge_replacement_fk
    foreign key(challenge_id,target_user_id_snapshot,replaced_device_id,replacement_device_id)
    references public.device_possession_challenges(
      id,target_user_id,replaced_device_id,replacement_device_id)
    on delete restrict,
  constraint system_owner_device_operations_consumer_fk
    foreign key(challenge_id,actor_user_id_snapshot,session_id,actor_device_id,
      actor_credential_id,challenge_purpose,environment,operation_id,consumer_kind)
    references public.device_possession_challenge_consumers(
      challenge_id,user_id,session_id,actor_device_id,actor_credential_id,
      challenge_purpose,environment,consumer_id,consumer_kind)
    on delete restrict,
  constraint system_owner_device_operations_action_purpose
    check (
      (action='approve_system_owner_pending_device'
        and challenge_purpose='SYSTEM_OWNER_PENDING_DEVICE_APPROVE'
        and target_device_id is not null and replaced_device_id is null
        and replacement_device_id is null)
      or (action='reject_system_owner_pending_device'
        and challenge_purpose='SYSTEM_OWNER_PENDING_DEVICE_REJECT'
        and target_device_id is not null and replaced_device_id is null
        and replacement_device_id is null)
      or (action='revoke_system_owner_device'
        and challenge_purpose='SYSTEM_OWNER_DEVICE_REVOKE'
        and target_device_id is not null and replaced_device_id is null
        and replacement_device_id is null)
      or (action='replace_system_owner_device'
        and challenge_purpose='SYSTEM_OWNER_DEVICE_REPLACEMENT'
        and target_device_id is null and replaced_device_id is not null
        and replacement_device_id is not null
        and replaced_device_id<>replacement_device_id)
    )
  ,constraint system_owner_device_operations_live_snapshot_consistency
    check ((actor_user_id is null or actor_user_id=actor_user_id_snapshot)
      and (target_user_id is null or target_user_id=target_user_id_snapshot))
);

create index system_owner_device_operations_target_created_idx
  on public.system_owner_device_authorization_operations(
    target_user_id_snapshot,created_at desc);

create or replace function public.guard_device_security_credential_lifecycle()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog, public
as $$
declare
  device_status text;
  device_revoked_at timestamptz;
begin
  if tg_op='INSERT' then
    if new.lifecycle_status<>'enrollment_pending' then
      raise exception 'DEVICE_SECURITY_CREDENTIAL_MUST_ENROLL_PENDING' using errcode='42501';
    end if;
    return new;
  end if;
  if tg_op='DELETE' then
    raise exception 'DEVICE_SECURITY_CREDENTIAL_DELETE_FORBIDDEN' using errcode='42501';
  end if;
  if new.id<>old.id or new.webauthn_credential_id<>old.webauthn_credential_id
    or new.user_id<>old.user_id or new.device_id<>old.device_id
    or new.credential_kind<>old.credential_kind
    or new.public_key_cose<>old.public_key_cose
    or new.public_key_algorithm<>old.public_key_algorithm
    or new.aaguid is distinct from old.aaguid
    or new.transports<>old.transports
    or new.backup_eligible<>old.backup_eligible
    or new.backup_state<>old.backup_state
    or new.user_verification_policy<>old.user_verification_policy
    or new.created_at<>old.created_at then
    raise exception 'DEVICE_SECURITY_CREDENTIAL_IDENTITY_IMMUTABLE' using errcode='42501';
  end if;
  if (old.enrolled_at is not null and new.enrolled_at is distinct from old.enrolled_at)
    or (old.activated_at is not null and new.activated_at is distinct from old.activated_at)
    or (old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at) then
    raise exception 'DEVICE_SECURITY_CREDENTIAL_SECURITY_TIME_IMMUTABLE' using errcode='42501';
  end if;
  if old.lifecycle_status='revoked' or
    (old.lifecycle_status='enrollment_pending' and new.lifecycle_status not in ('enrollment_pending','active','revoked')) or
    (old.lifecycle_status='active' and new.lifecycle_status not in ('active','rotation_pending','recovery_required','revoked')) or
    (old.lifecycle_status='rotation_pending' and new.lifecycle_status not in ('rotation_pending','active','recovery_required','revoked')) or
    (old.lifecycle_status='recovery_required' and new.lifecycle_status not in ('recovery_required','revoked')) then
    raise exception 'DEVICE_SECURITY_CREDENTIAL_TRANSITION_INVALID' using errcode='42501';
  end if;
  if new.sign_count<old.sign_count then
    raise exception 'DEVICE_SECURITY_CREDENTIAL_COUNTER_REGRESSION' using errcode='42501';
  end if;
  if new.lifecycle_status='active' and old.lifecycle_status<>'active'
  then
    select authorizations.authorization_status,authorizations.revoked_at
      into device_status,device_revoked_at
      from public.user_device_authorizations authorizations
      where authorizations.user_id=new.user_id
        and authorizations.device_id=new.device_id
      for update;
    if device_status is distinct from 'approved' or device_revoked_at is not null then
    raise exception 'DEVICE_SECURITY_CREDENTIAL_DEVICE_NOT_APPROVED' using errcode='42501';
    end if;
  end if;
  return new;
end;
$$;

create trigger device_security_credentials_lifecycle_guard
before insert or update or delete on public.device_security_credentials
for each row execute function public.guard_device_security_credential_lifecycle();

create or replace function public.guard_device_authorization_security_credential_state()
returns trigger language plpgsql security definer
set search_path=pg_catalog, public as $$
begin
  if tg_op='DELETE' then
    if exists(select 1 from public.device_security_credentials credentials
      where credentials.user_id=old.user_id and credentials.device_id=old.device_id
        and credentials.lifecycle_status<>'revoked') then
      raise exception 'DEVICE_AUTHORIZATION_HAS_LIVE_SECURITY_CREDENTIAL' using errcode='42501';
    end if;
    return old;
  end if;
  if (new.authorization_status='revoked' or new.revoked_at is not null)
    and exists(select 1 from public.device_security_credentials credentials
      where credentials.user_id=old.user_id and credentials.device_id=old.device_id
        and credentials.lifecycle_status<>'revoked') then
    raise exception 'DEVICE_AUTHORIZATION_HAS_LIVE_SECURITY_CREDENTIAL' using errcode='42501';
  end if;
  return new;
end;
$$;

create trigger user_device_authorizations_security_credential_guard
before update or delete on public.user_device_authorizations
for each row execute function public.guard_device_authorization_security_credential_state();

create or replace function public.guard_device_possession_challenge_identity()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog, public
as $$
begin
  if tg_op='INSERT' then
    if new.verified_at is not null or new.consumed_at is not null
      or new.failed_at is not null or new.failure_code is not null
      or new.verification_context is not null then
      raise exception 'DEVICE_POSSESSION_CHALLENGE_INITIAL_STATE_INVALID' using errcode='42501';
    end if;
    return new;
  end if;
  if tg_op='DELETE' then
    raise exception 'DEVICE_POSSESSION_CHALLENGE_DELETE_FORBIDDEN' using errcode='42501';
  end if;
  if new.id<>old.id or new.challenge_hash<>old.challenge_hash
    or new.user_id<>old.user_id or new.session_id<>old.session_id
    or new.actor_device_id<>old.actor_device_id
    or new.credential_id is distinct from old.credential_id
    or new.purpose<>old.purpose
    or new.target_user_id is distinct from old.target_user_id
    or new.target_device_id is distinct from old.target_device_id
    or new.replaced_device_id is distinct from old.replaced_device_id
    or new.replacement_device_id is distinct from old.replacement_device_id
    or new.operation_id is distinct from old.operation_id
    or new.expected_origin<>old.expected_origin
    or new.expected_rp_id<>old.expected_rp_id
    or new.environment<>old.environment
    or new.expires_at<>old.expires_at or new.created_at<>old.created_at then
    raise exception 'DEVICE_POSSESSION_CHALLENGE_BINDING_IMMUTABLE' using errcode='42501';
  end if;
  if old.consumed_at is not null or old.failed_at is not null then
    raise exception 'DEVICE_POSSESSION_CHALLENGE_TERMINAL' using errcode='42501';
  end if;
  if old.verified_at is null and new.verified_at is not null then
    if new.failed_at is not null or new.consumed_at is not null
      or new.verification_context is null or new.verification_context='{}'::jsonb then
      raise exception 'DEVICE_POSSESSION_CHALLENGE_VERIFICATION_INVALID' using errcode='42501';
    end if;
  elsif new.verified_at is distinct from old.verified_at
    or new.verification_context is distinct from old.verification_context then
    raise exception 'DEVICE_POSSESSION_CHALLENGE_VERIFICATION_IMMUTABLE' using errcode='42501';
  end if;
  if old.verified_at is not null and new.failed_at is not null then
    raise exception 'DEVICE_POSSESSION_CHALLENGE_VERIFIED_CANNOT_FAIL' using errcode='42501';
  end if;
  if new.consumed_at is not null and old.verified_at is null then
    raise exception 'DEVICE_POSSESSION_CHALLENGE_CONSUME_REQUIRES_VERIFICATION' using errcode='42501';
  end if;
  if old.consumed_at is null and new.consumed_at is not null and new.failed_at is not null then
    raise exception 'DEVICE_POSSESSION_CHALLENGE_TERMINAL_CONFLICT' using errcode='42501';
  end if;
  if old.consumed_at is null and new.consumed_at is not null
    and not exists(select 1 from public.device_possession_challenge_consumers consumers
      where consumers.challenge_id=old.id and consumers.challenge_purpose=old.purpose) then
    raise exception 'DEVICE_POSSESSION_CHALLENGE_CONSUMER_REQUIRED' using errcode='42501';
  end if;
  if old.failed_at is null and new.failed_at is not null and new.verified_at is not null then
    raise exception 'DEVICE_POSSESSION_CHALLENGE_FAILURE_INVALID' using errcode='42501';
  end if;
  return new;
end;
$$;

create trigger device_possession_challenges_identity_guard
before insert or update or delete on public.device_possession_challenges
for each row execute function public.guard_device_possession_challenge_identity();

create or replace function public.guard_device_possession_challenge_consumer()
returns trigger language plpgsql security definer
set search_path=pg_catalog, public as $$
declare
  challenge_row public.device_possession_challenges%rowtype;
begin
  if tg_op<>'INSERT' then
    raise exception 'DEVICE_POSSESSION_CHALLENGE_CONSUMER_IMMUTABLE' using errcode='42501';
  end if;
  select * into challenge_row from public.device_possession_challenges challenges
    where challenges.id=new.challenge_id and challenges.user_id=new.user_id
      and challenges.session_id=new.session_id
      and challenges.actor_device_id=new.actor_device_id
      and challenges.credential_id is not distinct from new.actor_credential_id
      and challenges.purpose=new.challenge_purpose
      and challenges.environment=new.environment
    for update;
  if not found or challenge_row.verified_at is null
    or challenge_row.failed_at is not null or challenge_row.consumed_at is not null
    or challenge_row.expires_at<=now() then
    raise exception 'DEVICE_POSSESSION_CHALLENGE_NOT_CONSUMABLE' using errcode='42501';
  end if;
  return new;
end;
$$;

create trigger device_possession_challenge_consumers_guard
before insert or update or delete on public.device_possession_challenge_consumers
for each row execute function public.guard_device_possession_challenge_consumer();

create or replace function public.guard_privileged_device_listing_session_lifecycle()
returns trigger language plpgsql security definer
set search_path=pg_catalog, public as $$
begin
  if tg_op='INSERT' then
    perform 1 from public.device_possession_challenges challenges
      where challenges.id=new.source_challenge_id
        and challenges.user_id=new.user_id and challenges.session_id=new.session_id
        and challenges.actor_device_id=new.actor_device_id
        and challenges.credential_id=new.credential_id
        and challenges.purpose='SYSTEM_OWNER_PENDING_DEVICE_LIST'
        and challenges.verified_at is not null
        and challenges.failed_at is null and challenges.consumed_at is null
        and challenges.expires_at>now()
      for update;
    if not found then
      raise exception 'PRIVILEGED_LISTING_SESSION_SOURCE_CHALLENGE_INVALID' using errcode='42501';
    end if;
    return new;
  end if;
  if tg_op='DELETE' then
    raise exception 'PRIVILEGED_LISTING_SESSION_DELETE_FORBIDDEN' using errcode='42501';
  end if;
  if new.id<>old.id or new.opaque_token_hash<>old.opaque_token_hash
    or new.user_id<>old.user_id or new.session_id<>old.session_id
    or new.actor_device_id<>old.actor_device_id or new.credential_id<>old.credential_id
    or new.source_challenge_id<>old.source_challenge_id
    or new.source_challenge_purpose<>old.source_challenge_purpose
    or new.environment<>old.environment
    or new.scope<>old.scope or new.issued_at<>old.issued_at or new.expires_at<>old.expires_at then
    raise exception 'PRIVILEGED_LISTING_SESSION_BINDING_IMMUTABLE' using errcode='42501';
  end if;
  if old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at then
    raise exception 'PRIVILEGED_LISTING_SESSION_REVOKED_TERMINAL' using errcode='42501';
  end if;
  return new;
end;
$$;

create trigger privileged_device_listing_sessions_lifecycle_guard
before insert or update or delete on public.privileged_device_listing_sessions
for each row execute function public.guard_privileged_device_listing_session_lifecycle();

create or replace function public.guard_system_owner_bootstrap_authorization_lifecycle()
returns trigger language plpgsql security definer
set search_path=pg_catalog, public as $$
begin
  if tg_op='INSERT' then
    if new.consumed_at is not null then
      raise exception 'SYSTEM_OWNER_BOOTSTRAP_INITIAL_STATE_INVALID' using errcode='42501';
    end if;
    return new;
  end if;
  if tg_op='DELETE' then
    raise exception 'SYSTEM_OWNER_BOOTSTRAP_DELETE_FORBIDDEN' using errcode='42501';
  end if;
  if new.id<>old.id or new.authorization_hash<>old.authorization_hash
    or new.intended_user_id<>old.intended_user_id or new.intended_device_id<>old.intended_device_id
    or new.environment<>old.environment or new.purpose<>old.purpose
    or new.intended_device_authorization_status<>old.intended_device_authorization_status
    or new.intended_device_revoked_at is distinct from old.intended_device_revoked_at
    or new.intended_user_system_owner<>old.intended_user_system_owner
    or new.issued_at<>old.issued_at or new.expires_at<>old.expires_at
    or new.operator_user_id<>old.operator_user_id or new.reason<>old.reason
    or new.issuance_audit_id<>old.issuance_audit_id then
    raise exception 'SYSTEM_OWNER_BOOTSTRAP_BINDING_IMMUTABLE' using errcode='42501';
  end if;
  if old.consumed_at is not null then
    raise exception 'SYSTEM_OWNER_BOOTSTRAP_CONSUMPTION_ONE_WAY' using errcode='42501';
  end if;
  if new.consumed_at is not null then
    raise exception 'SYSTEM_OWNER_BOOTSTRAP_CALLER_CONSUMED_AT_FORBIDDEN' using errcode='42501';
  end if;
  if statement_timestamp()<old.issued_at or statement_timestamp()>old.expires_at then
    raise exception 'SYSTEM_OWNER_BOOTSTRAP_CONSUMPTION_OUTSIDE_WINDOW' using errcode='42501';
  end if;
  new.consumed_at=statement_timestamp();
  return new;
end;
$$;

create trigger system_owner_bootstrap_authorizations_lifecycle_guard
before insert or update or delete on public.system_owner_credential_bootstrap_authorizations
for each row execute function public.guard_system_owner_bootstrap_authorization_lifecycle();

create or replace function public.guard_system_owner_recovery_authorization_lifecycle()
returns trigger language plpgsql security definer
set search_path=pg_catalog, public as $$
begin
  if tg_op='INSERT' then
    if new.status<>'pending_wait' or new.consumed_at is not null
      or new.not_before<=new.issued_at then
      raise exception 'SYSTEM_OWNER_RECOVERY_INITIAL_STATE_INVALID' using errcode='42501';
    end if;
    return new;
  end if;
  if tg_op='DELETE' then
    raise exception 'SYSTEM_OWNER_RECOVERY_DELETE_FORBIDDEN' using errcode='42501';
  end if;
  if new.id<>old.id or new.intended_user_id<>old.intended_user_id
    or new.intended_device_id<>old.intended_device_id
    or new.authorizing_credential_id is distinct from old.authorizing_credential_id
    or new.operator_user_id is distinct from old.operator_user_id
    or new.recovery_method<>old.recovery_method or new.issued_at<>old.issued_at
    or new.environment<>old.environment
    or new.not_before<>old.not_before or new.expires_at<>old.expires_at
    or new.reason<>old.reason or new.issuance_audit_id<>old.issuance_audit_id then
    raise exception 'SYSTEM_OWNER_RECOVERY_BINDING_IMMUTABLE' using errcode='42501';
  end if;
  if old.status in ('consumed','revoked','expired') then
    raise exception 'SYSTEM_OWNER_RECOVERY_TERMINAL' using errcode='42501';
  end if;
  if old.status='pending_wait' and new.status='ready'
    and statement_timestamp()<old.not_before then
    raise exception 'SYSTEM_OWNER_RECOVERY_WAITING_PERIOD_ACTIVE' using errcode='42501';
  end if;
  if (old.status='pending_wait' and new.status not in ('pending_wait','ready','revoked','expired'))
    or (old.status='ready' and new.status not in ('ready','consumed','revoked','expired'))
    or (old.consumed_at is not null and new.consumed_at is distinct from old.consumed_at)
    or (old.consumed_at is null and new.status<>'consumed' and new.consumed_at is not null) then
    raise exception 'SYSTEM_OWNER_RECOVERY_TRANSITION_INVALID' using errcode='42501';
  end if;
  if old.status='ready' and new.status='consumed' then
    if new.consumed_at is not null then
      raise exception 'SYSTEM_OWNER_RECOVERY_CALLER_CONSUMED_AT_FORBIDDEN' using errcode='42501';
    end if;
    if statement_timestamp()<old.not_before or statement_timestamp()>old.expires_at then
      raise exception 'SYSTEM_OWNER_RECOVERY_CONSUMPTION_OUTSIDE_WINDOW' using errcode='42501';
    end if;
    new.consumed_at=statement_timestamp();
  end if;
  return new;
end;
$$;

create trigger system_owner_recovery_authorizations_lifecycle_guard
before insert or update or delete on public.system_owner_credential_recovery_authorizations
for each row execute function public.guard_system_owner_recovery_authorization_lifecycle();

create trigger privileged_device_authorization_audit_immutable
before update or delete on public.privileged_device_authorization_audit_log
for each row execute function public.prevent_device_authorization_audit_mutation();

create trigger system_owner_device_authorization_operations_immutable
before update or delete on public.system_owner_device_authorization_operations
for each row execute function public.prevent_device_authorization_audit_mutation();

alter table public.webauthn_privileged_device_feature enable row level security;
alter table public.device_security_credentials enable row level security;
alter table public.device_possession_challenges enable row level security;
alter table public.device_possession_challenge_consumers enable row level security;
alter table public.privileged_device_listing_sessions enable row level security;
alter table public.system_owner_credential_bootstrap_authorizations enable row level security;
alter table public.system_owner_credential_recovery_authorizations enable row level security;
alter table public.privileged_device_authorization_audit_log enable row level security;
alter table public.system_owner_device_authorization_operations enable row level security;

revoke all on table public.webauthn_privileged_device_feature from public,anon,authenticated;
revoke all on table public.device_security_credentials from public,anon,authenticated;
revoke all on table public.device_possession_challenges from public,anon,authenticated;
revoke all on table public.device_possession_challenge_consumers from public,anon,authenticated;
revoke all on table public.privileged_device_listing_sessions from public,anon,authenticated;
revoke all on table public.system_owner_credential_bootstrap_authorizations from public,anon,authenticated;
revoke all on table public.system_owner_credential_recovery_authorizations from public,anon,authenticated;
revoke all on table public.privileged_device_authorization_audit_log from public,anon,authenticated;
revoke all on table public.system_owner_device_authorization_operations from public,anon,authenticated;
revoke all on function public.guard_device_security_credential_lifecycle() from public,anon,authenticated;
revoke all on function public.guard_device_authorization_security_credential_state() from public,anon,authenticated;
revoke all on function public.guard_device_possession_challenge_identity() from public,anon,authenticated;
revoke all on function public.guard_device_possession_challenge_consumer() from public,anon,authenticated;
revoke all on function public.guard_privileged_device_listing_session_lifecycle() from public,anon,authenticated;
revoke all on function public.guard_system_owner_bootstrap_authorization_lifecycle() from public,anon,authenticated;
revoke all on function public.guard_system_owner_recovery_authorization_lifecycle() from public,anon,authenticated;

-- Match the controlled owner of the existing protected device-authorization
-- foundation rather than inheriting an arbitrary migration executor owner.
do $$
declare
  controlled_owner name;
  relation_name text;
  function_signature text;
begin
  select pg_get_userbyid(classes.relowner) into controlled_owner
  from pg_class classes join pg_namespace namespaces on namespaces.oid=classes.relnamespace
  where namespaces.nspname='public' and classes.relname='user_device_authorizations';
  if controlled_owner is null then
    raise exception 'WEBAUTHN_PHASE_A_CONTROLLED_OWNER_MISSING';
  end if;
  foreach relation_name in array array[
    'webauthn_privileged_device_feature','device_security_credentials',
    'device_possession_challenges','privileged_device_listing_sessions',
    'device_possession_challenge_consumers',
    'system_owner_credential_bootstrap_authorizations',
    'system_owner_credential_recovery_authorizations',
    'privileged_device_authorization_audit_log',
    'system_owner_device_authorization_operations']
  loop
    execute format('alter table public.%I owner to %I',relation_name,controlled_owner);
  end loop;
  foreach function_signature in array array[
    'guard_device_security_credential_lifecycle()',
    'guard_device_authorization_security_credential_state()',
    'guard_device_possession_challenge_identity()',
    'guard_device_possession_challenge_consumer()',
    'guard_privileged_device_listing_session_lifecycle()',
    'guard_system_owner_bootstrap_authorization_lifecycle()',
    'guard_system_owner_recovery_authorization_lifecycle()']
  loop
    execute format('alter function public.%s owner to %I',function_signature,controlled_owner);
  end loop;
end;
$$;

do $$
declare
  table_name text;
  function_signature text;
  controlled_owner name;
begin
  select pg_get_userbyid(classes.relowner) into controlled_owner
  from pg_class classes join pg_namespace namespaces on namespaces.oid=classes.relnamespace
  where namespaces.nspname='public' and classes.relname='user_device_authorizations';
  foreach table_name in array array[
    'webauthn_privileged_device_feature','device_security_credentials',
    'device_possession_challenges','privileged_device_listing_sessions',
    'device_possession_challenge_consumers',
    'system_owner_credential_bootstrap_authorizations',
    'system_owner_credential_recovery_authorizations',
    'privileged_device_authorization_audit_log',
    'system_owner_device_authorization_operations']
  loop
    if not exists(
      select 1 from pg_class classes join pg_namespace namespaces
        on namespaces.oid=classes.relnamespace
      where namespaces.nspname='public' and classes.relname=table_name
        and classes.relrowsecurity
    ) then raise exception 'WEBAUTHN_PHASE_A_RLS_REQUIRED:%',table_name; end if;
    if exists(
      select 1 from pg_class classes join pg_namespace namespaces
        on namespaces.oid=classes.relnamespace
      cross join lateral aclexplode(coalesce(classes.relacl,
        acldefault('r',classes.relowner))) privileges
      where namespaces.nspname='public' and classes.relname=table_name
        and privileges.grantee=0
    ) or has_table_privilege('anon','public.'||table_name,'select,insert,update,delete')
      or has_table_privilege('authenticated','public.'||table_name,'select,insert,update,delete') then
      raise exception 'WEBAUTHN_PHASE_A_BROWSER_TABLE_PRIVILEGE:%',table_name;
    end if;
    if (select pg_get_userbyid(classes.relowner)
        from pg_class classes join pg_namespace namespaces on namespaces.oid=classes.relnamespace
        where namespaces.nspname='public' and classes.relname=table_name)<>controlled_owner then
      raise exception 'WEBAUTHN_PHASE_A_RELATION_OWNER_INVALID:%',table_name;
    end if;
    if exists(select 1 from pg_policy policies
      join pg_class classes on classes.oid=policies.polrelid
      join pg_namespace namespaces on namespaces.oid=classes.relnamespace
      where namespaces.nspname='public' and classes.relname=table_name) then
      raise exception 'WEBAUTHN_PHASE_A_POLICY_FORBIDDEN:%',table_name;
    end if;
  end loop;
  foreach function_signature in array array[
    'guard_device_security_credential_lifecycle()',
    'guard_device_authorization_security_credential_state()',
    'guard_device_possession_challenge_identity()',
    'guard_device_possession_challenge_consumer()',
    'guard_privileged_device_listing_session_lifecycle()',
    'guard_system_owner_bootstrap_authorization_lifecycle()',
    'guard_system_owner_recovery_authorization_lifecycle()']
  loop
    if exists(
      select 1 from pg_proc procedures
      cross join lateral aclexplode(coalesce(procedures.proacl,
        acldefault('f',procedures.proowner))) privileges
      where procedures.oid=to_regprocedure('public.'||function_signature)
        and privileges.grantee=0
    ) or has_function_privilege('anon','public.'||function_signature,'execute')
      or has_function_privilege('authenticated','public.'||function_signature,'execute') then
      raise exception 'WEBAUTHN_PHASE_A_BROWSER_FUNCTION_PRIVILEGE:%',function_signature;
    end if;
  end loop;
  if (select count(*) from public.webauthn_privileged_device_feature
      where singleton_id=1 and enabled=false)<>1 then
    raise exception 'WEBAUTHN_PHASE_A_FEATURE_MUST_BE_DISABLED';
  end if;
end;
$$;

commit;
