# CONFERENCE_CANONICAL_BUNDLE_EXPORT_RESTORE_COMPLETION_REPORT

## Ownership inventory

The canonical bundle owns only the Conference core and operational rows scoped by `conference_id`.

| Classification | Tables | Bundle behavior |
|---|---|---|
| Conference operational | `conferences`, `conference_participations`, `conference_house_assignments`, `conference_room_assignments`, `conference_accommodation_occupancies`, `conference_accommodation_pricing`, `conference_accommodation_pricing_room_exclusions`, `conference_air_conditioning_defaults`, `conference_air_conditioning_house_overrides`, `conference_air_conditioning_room_overrides`, `conference_branding`, `conference_finance_settings`, `conference_finance_items`, `conference_finance_adjustments`, `conference_restaurant_settings`, `conference_restaurant_price_overrides`, `conference_restaurant_count_overrides`, `conference_restaurant_participation_overrides`, `conference_transport_vehicles`, `conference_transport_assignments` | Exported from PostgreSQL. Conference-local UUIDs are deterministically remapped during restore; revisions and actor/timestamps are server-generated. |
| Shared Platform/Conference references | `conference_accommodation_houses`, `conference_accommodation_floors`, `conference_accommodation_rooms` | Never copied. House and room UUIDs are validated and re-linked to the existing central directory. Floors are reached through the validated room relation. |
| Reservations reference | `reservations.conference_person_links` | Never exported or restored. Reservations remains its operation owner and is not mutated. |
| Security/history | `conference_creation_operations`, `conference_participation_operations`, `conference_locks` | Never exported or restored. Existing server history and leases remain unchanged. |
| Canonical template authority | `library_templates`, `library_template_operations`, `library_template_audit_log` | Outside Conference bundles; retained under the already-approved central template contract. |

All operational tables reference `platform.profiles` through actor columns. Restore replaces those actor values with the current approved actor. `conference_participations.person_id` references `platform.people` and is validated, never imported. Operational foreign keys between participation, guardian, occupancy, transport, house assignment and room assignment are remapped inside the same PostgreSQL statement/transaction.

## Bundle contract

- Type: `conference-canonical-bundle`
- Schema version: `1`
- Maximum serialized size: 10 MiB
- Root fields: `type`, `schemaVersion`, `manifest`, `data`
- Manifest: source Conference/revision, export timestamp, section counts, SHA-256 payload digest and excluded authority classes.
- Restore modes: `new` or `replace`.
- `replace` requires explicit confirmation and an exact current revision.
- Restore requires a UUID operation ID, records an idempotency hash and writes a Platform audit event.
- Any validation, reference, permission or insert failure aborts the entire database statement.

## Deployment status

| Function | Status | Evidence |
|---|---|---|
| Server canonical export | PASS | Generated from the 20 server-owned operational tables in a rolled-back Development rehearsal. |
| Schema/hash/size/reference dry-run | PASS | Version, exact root fields, 10 MiB bound, SHA-256 and Platform/house/room references validated. |
| Atomic new restore | PASS | Full restore completed in Development and was rolled back; no persistent user rows were changed. |
| Failed-section rollback | PASS | Invalid Conference status aborted the restore and left neither a Conference nor an operation ledger row. |
| Idempotent replay | PASS | Repeating the same operation ID returned the same result and created one Conference only. |
| Replace policy | PASS | Missing confirmation and stale expected revision are rejected. No real replacement was executed. |
| Module isolation | PASS | Reservations links and all excluded Platform/security/history tables remained unchanged. |
| Direct browser ACL closure | PASS | `anon` and `authenticated` have no direct function execution; `service_role` dispatch is retained. |
| Browser device-session E2E | BLOCKED | Development had zero active Platform Owner device sessions during verification. No bypass or fallback was added. |
| Development database | PASS | Migrations applied to Development only. |
| Development Edge | PASS | `platform-device-operation` version 32 is ACTIVE with JWT verification. |
| Source workflows | PENDING | Updated after the final `develop` push and workflow verification. |

Supabase advisors report the established protected-RPC pattern as `RLS enabled, no policy`; the new private operation ledger is explicitly revoked from browser roles. The new device foreign key has a covering index. Existing project-wide advisor findings are outside this bundle change.
