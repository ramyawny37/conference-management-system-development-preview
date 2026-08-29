# Warehouse V1 canonical Platform packaging provenance

These migrations were reviewed in Warehouse Phase 5D.6 (PASS) and then packaged byte-for-byte into the Platform/Conference repository, which is the canonical migration authority. The package and its five forward corrections were applied to Development `gppwltrifgfxrkzvvxoe` only. Production remains unauthorized.

Source repository: `warehouse-management-system`

Source branch: `develop`

Source baseline HEAD: `c6f65c5efe911a410f2dee442a189dab0c70a0da`

| Original Warehouse filename | Original SHA-256 | Canonical Platform filename | Canonical SHA-256 | Identity | Review | Authority | Apply status | Authorized target |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `20260829000100_warehouse_module_permission_catalog.sql` | `d6f78aaa5536f29497eea7d426998d06ee95735be6c4c746fbfbec6eda5dfa61` | `20260829140000_warehouse_module_permission_catalog.sql` | `d6f78aaa5536f29497eea7d426998d06ee95735be6c4c746fbfbec6eda5dfa61` | `byte-identical` | Phase 5D.6 PASS | Platform/Conference canonical authority | `APPLIED_DEVELOPMENT` | Development `gppwltrifgfxrkzvvxoe` only |
| `20260829000200_warehouse_v1_business_schema.sql` | `095dcc4c7bfe6e54a1ad22c846f838bebe10a71ec60d7ba0fe7fc5fdfe472aae` | `20260829140100_warehouse_v1_business_schema.sql` | `095dcc4c7bfe6e54a1ad22c846f838bebe10a71ec60d7ba0fe7fc5fdfe472aae` | `byte-identical` | Phase 5D.6 PASS | Platform/Conference canonical authority | `APPLIED_DEVELOPMENT` | Development `gppwltrifgfxrkzvvxoe` only |
| `20260829000300_warehouse_v1_guarded_rpc.sql` | `771a45e8efe93de910766495f42a8ab40fb70fb8e535e59afb11baafe060e763` | `20260829140200_warehouse_v1_guarded_rpc.sql` | `771a45e8efe93de910766495f42a8ab40fb70fb8e535e59afb11baafe060e763` | `byte-identical` | Phase 5D.6 PASS | Platform/Conference canonical authority | `APPLIED_DEVELOPMENT` | Development `gppwltrifgfxrkzvvxoe` only |

## Phase 5G forward correction

Phase 5G discovered SQLSTATE `42702` in `warehouse_private.post_document(uuid,uuid,text,uuid,bigint)`: the local PL/pgSQL variable `submitted_revision` collided with unqualified references to `warehouse.adjustment_documents.submitted_revision`. The correction qualifies both affected adjustment reads without changing approval, lifecycle, replay, authorization, resource-scope, or result semantics. The previous three Warehouse migrations remain historical and byte-unchanged.

| Warehouse reviewed-source correction | Warehouse SHA-256 | Canonical Platform correction | Canonical SHA-256 | Identity | Apply status | Target |
| --- | --- | --- | --- | --- | --- | --- |
| `20260829000400_warehouse_v1_post_document_submitted_revision_ambiguity_correction.sql` | `7eda4615d56d95ff0b8ef3b290d54ca910173b740c482ee199f3e69f07ed1b81` | `20260829150000_warehouse_post_document_revision_ambiguity_correction.sql` | `7eda4615d56d95ff0b8ef3b290d54ca910173b740c482ee199f3e69f07ed1b81` | `byte-identical` | `APPLIED_DEVELOPMENT` as `20260829164307` | Development `gppwltrifgfxrkzvvxoe` only |

## Phase 5G.4 forward correction

Phase 5G.4 discovered SQLSTATE `55000` in `warehouse.post_reversal(uuid,uuid,uuid,bigint)`: the SQL relation alias `original` collided with the declared PL/pgSQL `record` variable `original` before that record had been assigned. The correction renames only the relation alias in the later-movement lineage guard to `original_movement`; reversal, approval, replay, lifecycle, authorization, movement, and audit semantics are unchanged. All previous Warehouse migrations remain historical and byte-unchanged.

| Warehouse reviewed-source correction | Warehouse SHA-256 | Canonical Platform correction | Canonical SHA-256 | Identity | Apply status | Target |
| --- | --- | --- | --- | --- | --- | --- |
| `20260829000500_warehouse_v1_post_reversal_alias_collision_correction.sql` | `6ece0b4bf9ac7d3a331b42fff5f6e4e1f9c9fc82d5ca0202b52fac3a6596a16c` | `20260829150100_warehouse_post_reversal_alias_collision_correction.sql` | `6ece0b4bf9ac7d3a331b42fff5f6e4e1f9c9fc82d5ca0202b52fac3a6596a16c` | `byte-identical` | `APPLIED_DEVELOPMENT` as `20260829165820` | Development `gppwltrifgfxrkzvvxoe` only |

## Phase 5G.7 forward correction

Phase 5G.7 failed with SQLSTATE `55000` and `WAREHOUSE_POSTED_DOCUMENT_IMMUTABLE` while `warehouse.post_reversal(uuid,uuid,uuid,bigint)` performed the authorized lifecycle-only `posted` to `reversed` transition. The failing boundary was `warehouse_private.protect_posted_header()`. A direct independent transactional reproduction confirmed that the shared trigger rejected the lifecycle-only update without any proven business-field mutation; the diagnostic transaction retained no data. The correction explicitly permits only the exact lifecycle transition while preserving posted business-field immutability, unconditional reversed-row immutability, and DELETE prohibition across receipt, issue, transfer, and adjustment headers. All previous Warehouse migrations remain historical and byte-unchanged.

| Warehouse reviewed-source correction | Warehouse SHA-256 | Canonical Platform correction | Canonical SHA-256 | Identity | Apply status | Target |
| --- | --- | --- | --- | --- | --- | --- |
| `20260829000600_warehouse_v1_posted_header_lifecycle_immutability_correction.sql` | `f4ca9e67e470521fa5c3a7870736ac463cc487ade9b32e85b85323170ca9abc4` | `20260829150200_warehouse_posted_header_lifecycle_immutability_correction.sql` | `f4ca9e67e470521fa5c3a7870736ac463cc487ade9b32e85b85323170ca9abc4` | `byte-identical` | `APPLIED_DEVELOPMENT` as `20260829171505` | Development `gppwltrifgfxrkzvvxoe` only |

## Final Development stabilization correction

The four-header executable regression proved that the Phase 5G.9 JSONB key-subtraction comparison still rejected the exact lifecycle-only `posted` to `reversed` transition with SQLSTATE `55000` and `WAREHOUSE_POSTED_DOCUMENT_IMMUTABLE`. The additive correction replaces only that failing comparison mechanism: it normalizes the three permitted lifecycle fields in `NEW` back to their `OLD` values before comparing the complete JSONB row. DELETE prohibition, unconditional reversed-row immutability, explicit `posted` to `reversed` gating, fixed `posted_at`, fixed `revision`, and all business/header identity and content immutability remain enforced. All previous Warehouse migrations remain historical and byte-unchanged.

| Warehouse reviewed-source correction | Warehouse SHA-256 | Canonical Platform correction | Canonical SHA-256 | Identity | Apply status | Target |
| --- | --- | --- | --- | --- | --- | --- |
| `20260829000700_warehouse_v1_posted_header_lifecycle_normalization_correction.sql` | `c748aa730ab811dc605e1468c53c29983127fbb8f2674c28d44249204b33dfb3` | `20260829150300_warehouse_posted_header_lifecycle_normalization_correction.sql` | `c748aa730ab811dc605e1468c53c29983127fbb8f2674c28d44249204b33dfb3` | `byte-identical` | `APPLIED_DEVELOPMENT` as `20260829172706` | Development `gppwltrifgfxrkzvvxoe` only |

The first stabilization regression rerun proved one additional PostgreSQL trigger-row detail: in a `BEFORE UPDATE` trigger, the stored generated `document_kind` column is not yet populated in `NEW`, while it is populated in `OLD`. The resulting apparent identity difference caused the normalized lifecycle comparison to reject receipt, issue, and transfer transitions. The next additive correction normalizes that database-generated key when present; adjustment headers have no `document_kind` key and retain the same generic shared-trigger path. No caller-controlled business field is excluded.

| Warehouse reviewed-source correction | Warehouse SHA-256 | Canonical Platform correction | Canonical SHA-256 | Identity | Apply status | Target |
| --- | --- | --- | --- | --- | --- | --- |
| `20260829000800_warehouse_v1_posted_header_generated_column_normalization_correction.sql` | `94ecbe7440bd1a8530bd74744fcb624d05af4ead883a5e5b4121995c6995bf22` | `20260829150400_warehouse_posted_header_generated_column_normalization_correction.sql` | `94ecbe7440bd1a8530bd74744fcb624d05af4ead883a5e5b4121995c6995bf22` | `byte-identical` | `APPLIED_DEVELOPMENT` as `20260829172841` | Development `gppwltrifgfxrkzvvxoe` only |

### Runtime harness stabilization

After the four-header regression passed, the full runtime reached immutable-history assertions and exposed a test-only PL/pgSQL name-resolution defect. The runtime block declares a local variable named `operation_id` under `#variable_conflict use_variable`; two unqualified `WHERE operation_id=...` predicates therefore resolved to that local variable and selected no audit or operation row. The test now qualifies only those predicates as `a.operation_id` and `o.operation_id`. The next rerun exposed a second harness-only name-resolution defect at the final deferred-constraint check: the constraint belongs to the `warehouse` schema, so the runtime now uses `set constraints warehouse.document_registry_correspondence immediate`. No business scenario, operation ID, expected behavior, authorization rule, or sequence policy changed. Runtime SHA-256 changed from `068c46331e7eb0d76d424ee3a12c6433d37937ab2b3e3efbbf519557de657011` to `1048224bdd22b15fcbd0f1f6534aed71bb97064282f5e81516de17760058862a`.

The corrected full Warehouse V1 single-session runtime passed all 11 sections on Development. All transactional fixtures rolled back, Warehouse grants remained zero, and no diagnostic objects persisted. True multi-session concurrency remains a **DEFERRED RELEASE GATE**.
