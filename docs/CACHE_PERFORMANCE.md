# Cache performance investigation

## Baseline and confirmed causes

Baseline on 2026-10-28: 149 existing offline tests pass. New focused regressions reproduce missing stale-partial exact caches and acceptance of a manifest whose snapshot was deleted (three failures, one passing fingerprint invariant).

| Suspected issue | Source verification |
| --- | --- |
| Stale results never cached | Confirmed: collection.js guards search writes with `!stats.staleBoards` |
| Stale snapshots invalidate exact reuse | Confirmed: every referenced manifest must satisfy `cache.fresh` |
| Network discovery before lookup | Confirmed: DiscoveryManager.ensure is awaited before reading the exact-search shard |
| Repeated oversized bulk content | Confirmed: no persisted per-board bulk failure/cooldown; every eligible collection can retry |
| Repeated individual enrichment | Confirmed: enrichOnce only shares in-flight promises in one process; errors have no retry metadata |
| Pruning after every search | Confirmed: search.js unconditionally calls cache.prune after collection, including exact hits |
| Consecutive refresh batches | Confirmed: without an exact hit, board scheduling sees updated last-fetch/query state and can advance through another 64 boards |
| Fingerprint/revision churn | Fingerprint already ignores timestamps/statistics (identity/status only). Preserve this. Manifests lack snapshot identity checks and can accept missing/corrupted files; observation fields are excluded from posting revisions, but persisted operational enrichment metadata must also be excluded |

Additional causes: bulk requests consume the individual request budget; metadata-only jobs with no query overlap can exhaust it before promising candidates; incompatible stale parser snapshots can fall through stale reuse; enrichment on a stale snapshot can extend envelope/manifest timestamps even though source observations are unchanged; exact-hit metrics repeat historical work counts. Fixes and measured outcomes will be recorded below.

The user's 129,081.86 ms / 104-request trace is reported production evidence, not a locally reproduced timing. Offline fixture measurements will be labeled separately.

## Cache-first correction
Exact lookup now precedes discovery and acquires no network resources on a hit. Partial/stale searches use CACHE_TTL.partialSearch (180 seconds), complete searches retain 600 seconds, both bounded by referenced freshness/retention and explicit posting expiry. References carry revisions, stale authorization and expiration boundaries. Parser/policy/filter/membership changes invalidate results; unrelated inventory timestamps do not. Date-filtered searches still re-evaluate their rolling boundaries. File-identity manifests validate shards through stat metadata without parsing postings on normal warm hits, and conservative upgrades validate legacy shards once. Search-level locks recheck cache after acquisition. Focused cache/pipeline/recovery tests: 19 passed.
