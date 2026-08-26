-- READ ONLY Development verification. Captures sensitive-table counts and stable fingerprints.
select current_database() database_name,current_user database_role,statement_timestamp() verified_at;
select 'devices' table_name,count(*) row_count,
 encode(digest(coalesce(string_agg(id::text||':'||user_id::text,'|' order by id),''),'sha256'),'hex') fingerprint
from public.devices
union all select 'user_device_authorizations',count(*),
 encode(digest(coalesce(string_agg(user_id::text||':'||device_id::text||':'||authorization_status,'|' order by user_id,device_id),''),'sha256'),'hex')
from public.user_device_authorizations
union all select 'device_security_credentials',count(*),
 encode(digest(coalesce(string_agg(id::text||':'||user_id::text||':'||device_id::text||':'||lifecycle_status,'|' order by id),''),'sha256'),'hex')
from public.device_security_credentials
union all select 'device_possession_challenges',count(*),
 encode(digest(coalesce(string_agg(id::text||':'||purpose||':'||coalesce(consumed_at::text,''),'|' order by id),''),'sha256'),'hex')
from public.device_possession_challenges
union all select 'system_owner_device_authorization_operations',count(*),
 encode(digest(coalesce(string_agg(operation_id::text||':'||action||':'||outcome,'|' order by operation_id),''),'sha256'),'hex')
from public.system_owner_device_authorization_operations
union all select 'privileged_device_authorization_audit_log',count(*),
 encode(digest(coalesce(string_agg(id::text||':'||action||':'||result,'|' order by id),''),'sha256'),'hex')
from public.privileged_device_authorization_audit_log;

select authorization_status,access.account_status,count(*)
from public.user_device_authorizations authorization
join public.system_user_access access on access.user_id=authorization.user_id
group by authorization_status,access.account_status order by authorization_status,access.account_status;

select classes.relname,classes.relrowsecurity,(select count(*) from pg_policy policies where policies.polrelid=classes.oid) policy_count
from pg_class classes join pg_namespace namespaces on namespaces.oid=classes.relnamespace
where namespaces.nspname='public' and classes.relname in ('device_security_credentials',
 'device_possession_challenges','device_possession_challenge_consumers','privileged_device_listing_sessions',
 'system_owner_device_authorization_operations','privileged_device_authorization_audit_log') order by classes.relname;
