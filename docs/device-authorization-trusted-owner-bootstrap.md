# P0.3D Manual Trusted-Owner Device Bootstrap

This is a deployment-only procedure. It does not activate the staged runtime,
enable enforcement, revoke legacy grants, or authorize a second device.

## Prepare an untracked deployment copy

Keep both repository SQL artifacts as fail-closed templates. Never place a real
user UUID, email, organization UUID, or device UUID in a tracked file.

1. Independently review the exact owner in `auth.users`, including the exact
   stored email (the bootstrap comparison is case-sensitive).
2. Confirm System Access is `approved`.
3. Confirm the exact membership is `organization_owner` in the reviewed
   organization.
4. Confirm the device already exists in `public.devices`, belongs to that user,
   and its exact authorization row is `registered` or `pending` with both
   `revoked_at` and `revoked_by` null.
5. Copy each SQL template to a local filename excluded from Git, preferably
   outside the repository. Check `git status --short` before continuing.
6. Replace all four placeholders in each local copy. Do not use broad lookup
   queries, the first device, or inferred identity values.

Required reviewed values are the trusted-owner user UUID, exact email,
organization UUID, and trusted device UUID.

Operator review checklist:

- [ ] Trusted owner UUID copied from the single exact `auth.users` result.
- [ ] Exact stored owner email reviewed character-for-character and copied
      without case normalization.
- [ ] Organization UUID copied from the exact owner-membership row.
- [ ] Trusted device UUID copied from the exact owned-device row.
- [ ] System Access is `approved`.
- [ ] Organization role is `organization_owner` for that exact organization.
- [ ] Authorization status is `registered` or `pending` before the first run.
- [ ] Both `revoked_at` and `revoked_by` are null.
- [ ] No other approved non-revoked device exists for the user.
- [ ] Enforcement has exactly one singleton and remains disabled.
- [ ] Both populated SQL copies are local and untracked.

Obtain them with exact, reviewed predicates. Replace the email and UUID inputs
in an untracked SQL Editor scratch query; never add `limit 1` or select an
unqualified first row:

```sql
select id, email from auth.users where email = 'EXACT_REVIEWED_EMAIL';

select m.organization_id, m.user_id, m.role
from public.organization_members as m
where m.organization_id = 'EXACT_REVIEWED_ORGANIZATION_UUID'::uuid
  and m.user_id = 'EXACT_REVIEWED_USER_UUID'::uuid;

select d.id, d.user_id, a.authorization_status, a.revoked_at, a.revoked_by
from public.devices as d
left join public.user_device_authorizations as a
  on a.user_id = d.user_id and a.device_id = d.id
where d.id = 'EXACT_REVIEWED_DEVICE_UUID'::uuid
  and d.user_id = 'EXACT_REVIEWED_USER_UUID'::uuid;

select user_id, account_status from public.system_user_access
where user_id = 'EXACT_REVIEWED_USER_UUID'::uuid;
```

## Execute and verify

Use the same reviewed literals without changing any value between runs:

1. In Supabase SQL Editor, run the populated read-only identity and precondition
   statements first. Before bootstrap, require the exact identity, membership,
   access, and ownership results; `registered` or `pending` authorization;
   null revocation fields; zero related bootstrap audit rows; no competing
   approved device; and disabled enforcement. Stop on any mismatch.
2. Run the complete populated bootstrap copy once.
3. Run the complete populated read-only verification copy.
4. Rerun the exact same populated bootstrap copy without changing any literal.
   This is the idempotent replay check.
5. Rerun the complete populated read-only verification copy.
6. After replay, require: exact authorization `approved`; `approved_at` and the
   audit `created_at` unchanged from step 3; `revoked_at` and `revoked_by` null;
   exactly one approved non-revoked device; exactly one matching and one related
   bootstrap audit event; one enforcement singleton; zero enabled enforcement
   rows; valid P0.3B/P0.3C ownership, RLS, function, helper, allowlist, and grant
   results; and unchanged legacy grants.
7. Separately prove repository/runtime inactivity with `git status`/`git diff`,
   an `index.html` reference scan, a service-worker cache scan, a staged-global
   reference scan, and confirmation that no active runtime file changed. The
   read-only SQL does not prove runtime inactivity.
8. Capture the deployed verification evidence, then permanently delete both
   populated local SQL copies. Confirm again that neither appears in Git status.
9. Stop and submit the evidence for explicit acceptance. Do not commit, push,
   deploy any other change, or begin P0.3E.

## Evidence result templates

Successful preflight:

```text
P0.3D PREFLIGHT: PASS
trusted_user_id: <reviewed UUID>
exact_email_match: true
account_status: approved
organization_id: <reviewed UUID>
role: organization_owner
device_id: <reviewed UUID>
exact_device_owner: true
authorization_status: registered | pending
revoked_at: null
revoked_by: null
approved_non_revoked_device_count: 0
related_bootstrap_audit_count: 0
enforcement_singleton_count: 1
enforcement_enabled_count: 0
```

Successful first run and exact replay:

```text
P0.3D FIRST BOOTSTRAP: PASS
P0.3D EXACT REPLAY: PASS (zero writes)
authorization_status: approved
approved_at_after_first: <timestamp>
approved_at_after_replay: <same timestamp>
bootstrap_audit_created_at_after_first: <timestamp>
bootstrap_audit_created_at_after_replay: <same timestamp>
approved_non_revoked_device_count: 1
matching_bootstrap_audit_count: 1
related_bootstrap_audit_count: 1
enforcement_singleton_count: 1
enforcement_enabled_count: 0
enforcement_remains_disabled: true
```

Failure/stop record:

```text
P0.3D: STOPPED — NOT APPROVED
step: <preflight | first bootstrap | first verification | replay | final verification>
database error code/message: <exact unedited output, if any>
failed or unexpected field: <name>
expected: <reviewed expected value>
actual: <actual value>
bootstrap transaction committed: no | unknown
enforcement_enabled_count: <value>
operator action: stopped; no literals changed; no corrective database mutation
```

Stop immediately without retrying or editing database state if any statement
fails, any query returns a missing/duplicate/unexpected row, either revocation
field is populated, another approved device exists, audit evidence conflicts,
enforcement is enabled, or any P0.3B/P0.3C invariant differs. Preserve the full
error and verification output for review.

An exact rerun is safe only when the same approved device and exactly matching
immutable audit evidence already exist. Any identity change, revocation evidence,
competing approved device, or conflicting audit evidence must fail closed.

No login, startup, browser RPC, registration flow, authorization request, or
active/staged runtime file may invoke this bootstrap.
