# Warehouse V1 canonical Platform packaging provenance

These migrations were reviewed in Warehouse Phase 5D.6 (PASS) and then packaged byte-for-byte into the Platform/Conference repository, which is the canonical migration authority. They are `NOT_APPLIED` and target Development only in the future, when explicitly authorized. This record does not authorize database access, migration execution, or deferred runtime SQL execution.

Source repository: `warehouse-management-system`

Source branch: `develop`

Source baseline HEAD: `c6f65c5efe911a410f2dee442a189dab0c70a0da`

| Original Warehouse filename | Original SHA-256 | Canonical Platform filename | Canonical SHA-256 | Identity | Review | Authority | Apply status | Authorized target |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `20260829000100_warehouse_module_permission_catalog.sql` | `d6f78aaa5536f29497eea7d426998d06ee95735be6c4c746fbfbec6eda5dfa61` | `20260829140000_warehouse_module_permission_catalog.sql` | `d6f78aaa5536f29497eea7d426998d06ee95735be6c4c746fbfbec6eda5dfa61` | `byte-identical` | Phase 5D.6 PASS | Platform/Conference canonical authority | `NOT_APPLIED` | Development-only future target when explicitly authorized |
| `20260829000200_warehouse_v1_business_schema.sql` | `095dcc4c7bfe6e54a1ad22c846f838bebe10a71ec60d7ba0fe7fc5fdfe472aae` | `20260829140100_warehouse_v1_business_schema.sql` | `095dcc4c7bfe6e54a1ad22c846f838bebe10a71ec60d7ba0fe7fc5fdfe472aae` | `byte-identical` | Phase 5D.6 PASS | Platform/Conference canonical authority | `NOT_APPLIED` | Development-only future target when explicitly authorized |
| `20260829000300_warehouse_v1_guarded_rpc.sql` | `771a45e8efe93de910766495f42a8ab40fb70fb8e535e59afb11baafe060e763` | `20260829140200_warehouse_v1_guarded_rpc.sql` | `771a45e8efe93de910766495f42a8ab40fb70fb8e535e59afb11baafe060e763` | `byte-identical` | Phase 5D.6 PASS | Platform/Conference canonical authority | `NOT_APPLIED` | Development-only future target when explicitly authorized |
