# P0.3E-1 Operational Device Administration

This gate deploys additive database contracts only. It does not activate the
guarded runtime, change `index.html` or `service-worker.js`, revoke protected
legacy grants, enable enforcement, or begin P0.3E-2.

## Deployment

1. Confirm P0.3B, P0.3C, and P0.3D deployed verification remains accepted.
2. Confirm the enforcement singleton exists once and is disabled.
3. Record the protected legacy RPC grant baseline.
4. Run `20260802_5_4_2_device_authorization_administration.sql` in Supabase SQL
   Editor as the deployment role.
5. Run `device-authorization-foundation-readonly-verification.sql`,
   `device-guarded-rpcs-readonly-verification.sql`, and
   `device-authorization-administration-readonly-verification.sql`.
6. Require one protected administration table with RLS enabled, FORCE RLS
   disabled, no browser table grants, six exact functions, one isolated helper,
   five authenticated-only RPCs, 27 unchanged guarded functions, 19 unchanged
   legacy grants, and disabled enforcement.
7. Stop and submit the SQL Editor results for review.

Do not use these RPCs to approve employee devices until the P0.3E-1 deployment
evidence and the later P0.3E-2 UI/operator workflow are separately approved.

The later enrollment gate cannot close until every enabled employee account
that is expected to retain protected access has exactly one approved,
non-revoked device, or has been explicitly excluded from the rollout.

Before the later legacy-grant revocation gate, confirm there are no in-flight
deployment operations or long-running synchronization tasks that still depend
on legacy RPCs.
