# Obsolete migration provenance

Files in this directory are retained byte-for-byte for historical provenance and are outside the active migration execution path. They must not be applied to any environment.

## 6.16.0 WebAuthn privileged-device security foundation

`20260824_6_16_0_webauthn_privileged_device_security_foundation.sql` was never applied to Conference Development (`gppwltrifgfxrkzvvxoe`) and has no row in its live `supabase_migrations.schema_migrations` history.

The actual Development lineage continued through `6.17.0`, `6.18.0`, and `6.19.0`, then introduced the WebAuthn/privileged-device foundation through the forward-only live migration `20260826224848_webauthn_privileged_device_foundation_reconciliation_6_19_1.sql`. Therefore `6.16.0` is obsolete and non-applicable to the Development lineage; `6.19.1` supersedes its intended foundation without rewriting or fabricating live history.

Do not delete, edit, rename back into the active migrations directory, or record `6.16.0` as applied.
