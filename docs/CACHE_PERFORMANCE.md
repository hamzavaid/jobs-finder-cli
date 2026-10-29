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

## Persistent enrichment retry policy
New failing regressions confirmed bulk requests consuming detail capacity and repeated individual failures across CollectionManager instances. Per-snapshot enrichment metadata now records bulk and source-qualified per-posting detail outcomes. Oversized/unsupported/structural responses cool down for 24 hours; transient failures for five minutes (source Retry-After is honored). Bulk defaults to eight attempts, separate from the existing 40-detail limit. Complete descriptions survive lightweight/partial refreshes. Candidate planning evaluates each record once, prioritizes keyword overlap and unknown supported hard filters, and reserves at most four detail calls for no-overlap exploration. Missing descriptions remain uncertain; unsupported applicant/verification criteria cannot trigger pointless enrichment. Operational retry metadata and query-dependent planning order do not change semantic posting revisions. Focused enrichment/cache regression tests passed.

## Maintenance, scheduling and diagnostics
Cache pruning uses a persisted daily lease and a cross-process lock; exact-hit searches skip pruning entirely. Old unchanged snapshot files remain retained when their current manifest proves recent source observations. Cooled-down boards follow eligible boards in the bounded refresh order; exact hits do not advance the batch. Search-level locking prevents duplicate same-query collection; separate board locks remain for different queries. Diagnostics distinguish historical coverage from work this run, show explicit miss reasons, reset network/enrichment counters on hits, and say jobs returned rather than equating the output cap with all accepted postings. Timing counters separate discovery, collection, enrichment, filtering and cache reads/writes; worker/IO timings can overlap, so they are not additive wall-clock stages.

## Reproducible before/after measurement
Run npm run benchmark:cache. The deterministic fixture seeds 130 stale boards with 4,160 postings, incomplete descriptions, archive 503 responses and one oversized Greenhouse bulk response. It runs the exact Software Engineer/Greenhouse CLI command twice in separate Node processes. HTTP is mocked; a virtual service clock advances rate-limit/backoff waits. Node process startup, disk IO, parsing/filtering and exact validation are real. No live-latency guarantee is inferred.

Comparison against baseline commit 8427828 in an isolated ignored source copy:

| Measurement | Baseline | Fixed |
| --- | ---: | ---: |
| First execution wall time | 1,639 ms | 1,813 ms |
| First execution HTTP requests | 112 | 120 |
| Second execution wall time | 2,287 ms | 695 ms |
| Second execution pipeline time | 1,792 ms | 72 ms |
| Second execution HTTP requests | 104 | 0 |
| Second execution bulk attempts | 40 | 0 |
| Second execution individual attempts | 0 | 0 |
| Results returned per execution | 25 | 25 |

A separate focused test measured a 575 ms warm execution with zero requests. No timing threshold is asserted in CI; heavy parallel test load can exceed one second. The fixed cold fixture uses all 40 individual slots plus eight bulk slots; the baseline consumed the shared budget with nine bulk and 31 individual calls. That accounts for eight additional bounded cold requests; timeout, HTTP size limits, concurrency and board-refresh budget were not increased. The optimization is eliminating repeated work, not reducing every cold search's request count.
