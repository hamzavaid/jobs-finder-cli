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

Current extension (2026-10-29): date-filtered searches cache results only until the
next possible eligibility transition, including rejected/future candidates. Source
keys now exclude unrelated provider selections and include effective budgets and
filter/relevance versions. Board observation bookkeeping uses a keyed Map.
See [pipeline hardening](PIPELINE_HARDENING.md) for the evidence policy, current
measurements, HTTP-attempt diagnostics and bounded-contention limitations.

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
## Cache policy reference

All durations are centralized in `CACHE_TTL` in `src/cache.js`.

| Policy | Duration / behavior |
| --- | --- |
| Complete, fresh exact results | At most 10 minutes |
| Partial coverage or usable stale exact results | At most 3 minutes |
| ATS board freshness | 20 minutes (existing source-specific feed TTLs remain) |
| Authorized stale retention | At most 7 days from the successful source observation; writing a search or retry record does not restart this window |
| Transient enrichment failure | 5-minute default; a supplied source retry deadline is honored |
| Oversized / unsupported / structural enrichment failure | 24-hour default, bounded rather than permanent |
| Maintenance | At most once daily on collection searches; never scans during an exact-hit search |

Exact TTL is also capped by each reference's original authorization boundary, each returned job's freshness/stale-retention boundary, and explicit posting expiry. A result originally using fresh snapshots cannot silently remain labeled fresh after those snapshots expire. A reference originally authorized stale may remain expired in the freshness sense, but only until its recorded stale deadline. Stale returned rows retain original `lastObservedAt`, `cacheFetchedAt`, `cacheStatus`, and provenance.

Invalidation checks: normalized semantic arguments and selected providers; parser and search-policy versions; eligible inventory identity/status fingerprint; exact envelope expiration; referenced semantic revisions; snapshot file identity; original reference authorization; current source stale deadline; explicit posting expiry. Missing, corrupt, pending replacement or incompatible records miss conservatively. Inventory observation timestamps, query statistics, refresh timestamps and random inventory revisions alone do not invalidate membership. Retry metadata and query-planning row order do not change posting content revisions. Rolling `--date` queries intentionally bypass exact results and re-evaluate their boundaries through collection.

Normal manifest hits use small JSON metadata and file-stat identity (size, mtime, ctime, inode), with zero full posting-shard parses. This is local consistency validation, not a cryptographic defense against a hostile actor rewriting cache contents and filesystem metadata. Corruption recovery remains automatic. Legacy unstamped manifests validate their snapshots once and upgrade conservatively; the first search after upgrading the cache policy is therefore not guaranteed to be warm.

Persisted enrichment state lives inside each existing posting snapshot as `enrichment.bulk` and `enrichment.details[providerJobId]`; the enclosing provider/tenant/region key qualifies the posting ID. Attempts retain status, failure kind, attempt/success times and retry deadline. Successful content remains in normalized job rows. Metadata-only updates can write a shard to preserve a failure, but cannot extend its source observation timestamp. No additional service or database is introduced.

Diagnostics explicitly distinguish exact hits/miss reasons, persisted inventory reuse, posting reuse, prior stale coverage, current board refreshes, bulk outcomes, individual attempts/reuse/cooldowns, API/index HTTP requests, jobs returned and postings passing local filtering. Timing fields record discovery, collection, enrichment, filtering, cache reads and cache writes. Collection time includes its worker work; enrichment and filesystem times can overlap and must not be summed as independent elapsed stages. Shared filesystem counters are aggregated once across providers. No-network warm hits reset work counters and report historical coverage separately.

## Final review and verification

Additional review regressions confirm:

- Exact hits parse no posting snapshots and keep complete-result TTL at ten minutes.
- Mismatched source timestamps cannot extend manifest freshness.
- Partial-cache expiry resumes a different bounded refresh batch, while valid repeats do not.
- Board-lock contention may use stale records but cannot start duplicate enrichment.
- Immutable old snapshot files with currently observed manifests survive pruning.
- Shared cache IO time is not double-counted across concurrent providers.

All original provider, saved-job, export, filtering, cancellation and CLI tests remain in the suite. Clean installation and recursive syntax lint succeeded; npm audit reported zero vulnerabilities. The repository's existing offline CI automatically includes the new regressions; hosted GitHub Actions was not run locally.

### Modified files and milestone commits

| Area | Files |
| --- | --- |
| Exact lookup, bounded partial reuse, retry planning | `src/collection.js` |
| Snapshot identity, coordinated writes, stale policy, daily pruning | `src/cache.js` |
| Persistent retry helpers, richer-field reuse, oversized error classification | `src/enrichment.js`, `src/api-http.js` |
| Scheduling and search aggregation | `src/board-scheduler.js`, `src/search.js` |
| Diagnostics | `src/pipeline-metrics.js`, `src/cli.js` |
| Reproducible measurements | `scripts/cache-performance.js`, `test/helpers/cache-performance-fixture.js`, `package.json` |
| Regression coverage | `test/cache-first.test.js`, `test/enrichment-retry.test.js`, `test/cache-maintenance.test.js`, `test/cache-performance.test.js`, `test/manifest-pruning.test.js`, `test/refresh-recovery.test.js`, `test/cache-metrics.test.js` |
| User and technical docs | `README.md`, `docs/ATS_ARCHITECTURE.md`, `docs/CACHE_PERFORMANCE.md` |

Verified milestones: `fb8e208` (baseline and intentionally failing reproductions), `d67eb5c` (cache-first and stale partial reuse), `21ebe71` (persistent enrichment cooldowns), `db6ed37` (maintenance, metrics and 130-board fixture), followed by the final review/documentation commit.

## Remaining limitations

- The under-one-second goal is measured on isolated fixture runs, not guaranteed for every disk, antivirus setup, Node startup, provider combination or machine. Parallel CI load can be slower. The invariant is zero network on a valid immediate repeat.
- A changed query/filter, expired TTL, changed inventory membership/posting revision, missing/corrupt shard or parser-policy upgrade legitimately causes a miss. Rolling date searches reuse exact results only before their next eligibility transition; reaching that boundary triggers re-evaluation.
- A cold miss may still be expensive and partial. Public archive failures, source restrictions and the 16 MiB safety limit remain; this fix does not claim complete platform coverage or bypass access restrictions.
- A same-query cold follower waits within the existing two-second process-lock budget; if the owner has not finished, it reports busy rather than duplicating collection. Valid exact hits do not acquire that collection lock.
- Unwritable caches or oversized exact-result files cannot guarantee persistent reuse; optional cache failures remain visible. No external credentials, setup commands, daemon, paid service or database server are required.

Final verification after all review fixes: 166 tests passed, zero failed/skipped, on Windows Node 20.20.2, 22.23.4, 24.22.1 and 25.2.1. npm ci, npm run lint, npm test, npm audit (zero vulnerabilities), local documentation-link validation and git diff --check succeeded. The test count includes the Node test runner's helper-file entry; all original regressions remain intact. No runtime dependencies, public CLI flags, credentials or setup commands were added. All milestone commits remain local and have not been pushed.
