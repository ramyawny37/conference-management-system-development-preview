# Conference Development established baseline before 6.17

Conference Development already contained the application schema established by the repository migrations through `6.15.0` before the currently inspectable live migration-history segment beginning with `6.17.0`.

This established schema is provenance, not fabricated migration history. No rows for the pre-`6.17.0` source files may be inserted into or inferred as rows of `supabase_migrations.schema_migrations`. Reproducibility must use the established baseline artifact/schema evidence together with the authoritative live forward lineage recorded in `DEVELOPMENT_PLATFORM_FOUNDATION_LINEAGE.json`.

The source file formerly numbered `6.16.0` is explicitly excluded. Its preserved contents and non-applicability are documented in `../obsolete/README.md`.
