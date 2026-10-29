# Pipeline improvements

## Baseline and workflow
Baseline: 117 offline tests passed on Node 25.2.1 (2026-10-28). Existing six adapters, automatic inventory discovery, atomic cache storage and saved records are retained. No runtime dependencies added.

## Phase 1 � lexical retrieval
Implemented NFKC tokenization, explicit morphology and configurable equivalent aliases, quoted phrases, technical-token boundaries, available-signal scoring (40/25/20/10/5 defaults), structured filter decisions and deterministic global ranking. Each provider contributes a bounded candidate pool (at least 100, at most 1000), then global ranking applies the user limit. Explicit filters remain mandatory. Updated previous interleaving assertions because the requested ordering changed; count, concurrency and failure assertions remain. Baseline phrase behavior remains available for benchmarks.

## Phase 2 - selective enrichment
Common enrichJob contracts, shared in-flight requests, 40-request search budget (constructor configurable), two concurrent board workers, transport timeout/size/cancellation bounds, bulk Greenhouse content for multiple unresolved records, cached richer-field preservation, and explicit incomplete-evidence diagnostics. Greenhouse bulk selection uses request count; byte-cost prediction remains unavailable without source size metadata.

## Phase 3 - additional public sources
Added SmartRecruiters PUBLIC-only list/detail APIs with offset pagination, Personio enabled XML feeds, Himalayas cursor feed, and Remotive feed. All use existing transport/cache/filter orchestration. Anonymous live adapter checks: SmartRecruiters 3 jobs; Personio empty valid XML (nonempty parsing fixture-tested only); Himalayas 20 jobs with page-budget warning; Remotive 11 jobs. 123 offline tests passed. Remotive refresh policy is six hours, Himalayas daily. Their attribution, source URLs and redistribution restrictions travel with each record. Source terms: https://developers.smartrecruiters.com/docs/posting-api ; https://support.personio.de/hc/en-us/articles/207576365 ; https://himalayas.app/api ; https://github.com/remotive-com/remote-jobs-api . GitHub leads and permitted employer pages attach in the discovery/resolution phases, not as invented postings.

## Phase 4 - independent employer discovery
Public GitHub job lists now supply dynamically extracted board candidates independently of archive indexes; no company registry is shipped. Shared per-search list retrieval avoids duplicate downloads across providers. HTML, Markdown and sitemap link extraction is reusable. Candidates preserve tenant/region, URL, discovery method and observed timestamps; existing validation, resumable cursors, negative expiry and additive merge remain. Cold starts with enough public-list candidates defer archive work and explicitly remain partial. These lists skew toward early-career technology roles; board-wide collection and lexical matching remain occupation-neutral. Fourteen focused tests passed.

## Phase 5 - query-aware scheduling
Added deterministic bounded board ordering, decayed prior match counts (seven-day exponential decay), company priority, age-based starvation protection and 25% exploration reservation. Up to eight query observations per board are persisted. Added scheduled/refreshed/skipped/blocked counters while retaining cancellation and source cooldowns. Thirteen focused scheduling/pipeline/recovery tests passed.

## Phase 6 - posting resolution
Added public posting resolver, JSON-LD and scoped microdata parsing, safe canonicalization, explicit five-state results, positive/negative resolution caches, robots checks, one-hop ATS routing, and optional GitHub source (eight posting resolutions per batch). Generic employer pages are resolved from discovered leads; there is no unrestricted crawler. HTTPS transport pins checked DNS answers at connection time, rejects private/reserved IPv4/IPv6 targets, credentials, redirects and oversized/time-limited bodies. List-only snippets never become postings. Generic HTML selectors are intentionally limited to Schema.org metadata rather than speculative universal layouts. Fourteen focused adapter/resolver/cache tests passed.

## Phase 7 - normalized contract
Versioned job schema and parser revision, identity validation, source/provenance defaults, conservative timestamp validation, salary currency/period checks, richer description states and read-time saved-record normalization added. ATS adapters quarantine malformed individual rows and mark affected snapshots partial. Parser revisions invalidate posting freshness and exact query keys. Full run exposed one remaining Greenhouse fail-whole-response branch; corrected and regression-tested. Ten focused schema/adapter/store tests passed (full-suite rerun follows).

## Phase 8 - tiered identities
Hash-indexed exact provider/tenant/region IDs, verified employer plus requisition IDs, and compatible observed-employer canonical posting URLs consolidate before global limits. Original source records and all provenance remain attached. Conflicting employers/requisitions stay separate; high-similarity description buckets supply possibleDuplicateOf hints only. Candidate similarity buckets cap at 20 records. Nine focused dedup/recovery/search tests passed.

## Phase 9 - cache coordination and revisions
Added small atomic posting-revision manifests for exact-search validation, skip large snapshot rewrites when semantic revisions/capabilities are unchanged, preserve freshness in manifests, and coordinate board collection through a separate cross-process refresh lock. Contention falls back to available cache and reports partial coverage. Added bounded in-process ETag/Last-Modified reuse (eight responses, two MiB each); validators are not persisted across processes. Existing JSON storage remains sufficient. Eight focused transport/coordination tests and nineteen cache/pipeline/recovery tests passed.

## Phase 10 - observability and offline quality
Added pipeline counters and stderr summaries, doctor schema/parser/budget health, HTTP request/byte counters, and npm run benchmark. Fixtures cover six queries across nursing, accounting, chefs and technical terms. Labels are synthetic/provisional, not validated ground truth. Initial macro metrics: baseline Precision@10 0.1167, NDCG@10 0.7311, recall 0.75; improved 0.15, 1.0, 1.0. Precision uses fixed denominator 10 even for short lists. Two duplicate pairs scored precision/recall 1.0, and one structured posting resolved (too small for production-quality claims). Initial mocked cold/warm collection: 66.8/7.4 ms, 3/0 requests. Lexical retrieval itself costs more CPU than substring matching; no CPU speedup claimed.

## Phase 11 - QA, security and CI
Expanded cold/warm CLI coverage for all four added API/feed sources, enrichment-before-rejection, attribution in exports, prototype-safe lexical aliases, future-date ranking, DNS/private targets, manifests and real cross-process refresh coordination. Existing 117 tests retained, ordering expectations updated for the requested global ranking, and new deterministic regressions added. CI now runs the offline benchmark and all provider URL/help checks on its existing Windows/Linux Node 20/22/24 matrix. npm ci succeeded; npm audit reported zero vulnerabilities (network-enabled audit; restricted first attempt could not reach the advisory endpoint). All 140 tests passed on Windows Node 20.20.2, 22.23.4, 24.22.1 and 25.2.1 before three final regression cases; those three also passed. Node 20 initially hit sandbox parent-directory EPERM, then passed outside that filesystem restriction. Optional GitHub live resolution returned two complete postings from two leads; all remaining links were explicitly unvisited. Hosted CI has not been executed here.

## Phase 12 - independent-style implementation review

Reviewed each modified stage against failure isolation, unknown evidence, bounded work, compatible saved data, output separation and zero-configuration requirements. Confirmed and fixed during review:

- Replaced quadratic cached-job lookups with ID maps during snapshot refresh.
- Preserved source-specific freshness and attribution/restrictions in table and CSV output.
- Made unavailable refresh locks fall back to collection with persistence warnings.
- Handled quoted-phrase uncertainty and prototype-like lexical terms safely; ignored future dates for ranking.
- Used the live-verified anonymous Himalayas keyword endpoint with query-qualified snapshots, bounded/repeated-page handling and explicit expiry. A live nurse search returned 20 postings; no key was used.
- Separated Personio .com/.de host identity without claiming geographic region; parser version 4 invalidates previous semantics.
- Removed unrestricted legacy HTML redirects, capped HTML response bodies, and shared the global scheduler across HTML, APIs and generic posting resolution. A fresh LinkedIn live smoke check still parsed three chef postings.
- Added regressions for query-scope expiry, provider-order-independent ranking, shared concurrency and legacy HTTP bounds.

### Previous versus current behavior

| Stage | Previous | Current |
| --- | --- | --- |
| Retrieval | Literal ATS substring phrase | Token/variant/alias evidence with quoted phrases and preserved technical tokens |
| Ordering | Selected-provider interleaving before total limit | Candidate pooling, strong consolidation, global deterministic ranking, then limit |
| Description evidence | Metadata omissions often rejected immediately | Selective bounded enrichment; failed/insufficient evidence disclosed |
| Sources | Six integrations | Ten default sources plus optional GitHub leads and permitted employer-page resolution |
| Discovery | Archive/index dependence | Independent dynamic public-list candidates plus existing indexes |
| Scheduling | Oldest fetch first | Company/query/history/activity/age priority with exploration |
| Duplicates | URL hints only | Tiered compatible identity consolidation with originals and conflict preservation |
| Repeated work | Full snapshot reads for revision checks | Small manifests, unchanged-write avoidance and cross-process refresh coordination |
| Diagnostics | Scan counts and warnings | Additional source/board/completeness/resolution/cache/request/byte/time summaries |

### Verified measurements

Initial small synthetic benchmark: Precision@10 0.1167 to 0.1500, NDCG@10 0.7311 to 1.0000, recall 0.75 to 1.00. Two duplicate pairs and one resolution fixture passed. These labels are provisional and the set is much too small to establish real-world retrieval quality. The initial offline collection measured 66.8 ms cold and 7.4 ms warm, with 3 versus 0 mock requests. A later isolated run measured 53.1/3.4 ms. Timing varies with runtime, disk and concurrent test load. CPU retrieval costs increased versus substring matching; cache reuse, completeness and correctness are the measured benefits.

Live evidence: SmartRecruiters list parsed three public postings; Himalayas browse parsed 20 (partial) and keyword nurse search returned 20; Remotive parsed 11; Personio returned valid empty XML; optional GitHub resolved two complete postings from two leads; LinkedIn parsed three chef postings after final transport hardening. Indeed/Glassdoor remain subject to previously recorded 403 restrictions. No claim is made that every provider filter or every discovered employer was live-tested.

### Changed areas and milestone commits

- Retrieval/filtering/ranking: relevance.js, filter-engine.js, search.js, filters.js.
- Providers: ats/smartrecruiters.js, ats/personio.js, sources/feeds.js, sources/github.js, original ATS enrichment contracts, providers.js.
- Discovery/scheduling: discovery.js, employer-candidate.js, board-scheduler.js, collection.js.
- Resolution/security: resolution.js, posting-parser.js, public-http.js, api-http.js, http.js, concurrency integration.
- Data/storage/output: schema.js, enrichment.js, dedup.js, cache.js, store.js, output.js.
- Diagnostics/quality: pipeline-metrics.js, cli.js, scripts/benchmark.js, optional smoke updates, fixture/regression/CLI tests, CI workflow, README and architecture documentation.

| Phase | Commit |
| --- | --- |
| 1 relevance | 4bac9e0 |
| 2 enrichment | c845ac3 |
| 3 public sources | c270a0c |
| 4 independent discovery | 38edc10 |
| 5 scheduling | 5ee8719 |
| 6 posting resolution | 216eb80 |
| 7 normalized contract | 01f81ba |
| 8 identities | a05a0fb |
| 9 caches | 55b8ac9 |
| 10 metrics/benchmark | e2dcada |
| 11 QA/CI | 8d1f5f8 |
| 12 review/documentation | Final milestone commit follows these verified changes |

### Remaining limits and recommended improvements

1. Discovery and collection remain bounded, partial and biased by available indexes/public lists. They cannot enumerate all legitimate public jobs. A larger, independently reviewed multi-occupation corpus is the most useful next quality improvement.
2. Personio's nonempty feed extraction is fixture-verified only; live data was empty. Disabled XML feeds cannot be enabled by this client. Generic HTML without supported metadata stays unsupported; no browser automation or broad selector guessing was introduced.
3. GitHub is optional, resolves eight leads per batch and is not a broad occupational index. No manually maintained company registry is required.
4. Public restrictions (including Indeed/Glassdoor 403), shared anonymous API rate limits and archive outages still limit results. No circumvention is provided.
5. HTTP validator bodies stay in a small in-process cache. Cross-process bodies/validators and SQLite were not added without demonstrated benefit. Exact caches and semantic revisions already avoid repeated filtering for identical searches.
6. Source terms travel with feed records. Remotive/Himalayas data must not be resyndicated to prohibited third-party job boards. Application links and source attribution remain intact.
7. Live access can change. Hosted GitHub Actions was updated but has not been run or pushed from this session; local Windows validation does not prove hosted Linux execution.

Final platform/encoding check also found a Windows shell encoding loss in the closed-list marker. Replaced the marker with an ASCII Unicode escape and added a literal-code-point HTML/Markdown regression so closed rows are excluded reliably. Final validation totals are recorded below.

### Final validation
149 tests passed with zero failures/skips on Windows using Node 20.20.2, 22.23.4, 24.22.1 and 25.2.1 after the final encoding fix. npm ci, recursive syntax lint, offline benchmark invariants, git diff --check, local documentation links, find-flag documentation coverage and workflow YAML/matrix validation succeeded. npm audit reported zero vulnerabilities. No runtime dependencies were added. All twelve milestones are local Git commits; they have not been pushed, and hosted CI was not run.
