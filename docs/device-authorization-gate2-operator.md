# P0.3E-2 Device Administration UI

Gate 2 adds only the current-device status and manager device-administration
surfaces. Enforcement must remain disabled, protected legacy grants must remain
unchanged, and normal protected application paths must remain on P0.2.

## Deployment verification

1. Deploy the reviewed static assets and `index.html`/service-worker update.
2. Confirm cache revision `p0-3e-2-device-administration-ui` is installed.
3. Confirm the five Gate 2 scripts exist in both `index.html` and `CORE_ASSETS`
   in dependency order.
4. Confirm no staged P0.3C runtime asset is loaded or cached.
5. On the approved owner device, verify the Arabic current-device status once.
6. Use only the explicit `تحديث الحالة` button for later status refreshes.
7. Verify manager organization/member selection and perform a read-only exact
   member-device list. Do not begin employee enrollment or mutate device state.
8. Confirm existing P0.2 protected application behavior still works.
9. Run the approved database read-only verification and confirm enforcement is
   disabled and legacy grants match their per-signature baseline.
10. Stop and submit Gate 2 evidence. Do not begin Gate 3.

## Rollback

Restore only the prior Gate 2 HTML asset references/roots and service-worker
asset entries, then advance to a new cache revision. Do not reuse the failed
cache name. Leave P0.3E-1 contracts, device approvals, audits, enforcement, and
legacy grants unchanged.
