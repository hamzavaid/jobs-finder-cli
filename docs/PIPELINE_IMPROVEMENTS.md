# Pipeline improvements

## Baseline and workflow
Baseline: 117 offline tests passed on Node 25.2.1 (2026-10-28). Existing six adapters, automatic inventory discovery, atomic cache storage and saved records are retained. No runtime dependencies added.

## Phase 1 — lexical retrieval
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
Versioned job schema and parser revision, identity validation, source/provenance defaults, conservative timestamp validation, salary currency/period checks, richer description states and read-time saved-record normalization added. ATS adapters quarantine malformed individual rows and mark affected snapshots partial. Parser revisions invalidate posting freshness and exact query keys. Full run exposed one remaining Greenhouse fail-whole-response branch; corrected and regression-tested. Eight focused schema/adapter/store tests passed (full-suite rerun follows).

## Phase 8 - tiered identities
Hash-indexed exact provider/tenant/region IDs, verified employer plus requisition IDs, and compatible observed-employer canonical posting URLs consolidate before global limits. Original source records and all provenance remain attached. Conflicting employers/requisitions stay separate; high-similarity description buckets supply possibleDuplicateOf hints only. Candidate similarity buckets cap at 20 records. Nine focused dedup/recovery/search tests passed.
