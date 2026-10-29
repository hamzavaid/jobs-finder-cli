# Pipeline improvements

## Baseline and workflow
Baseline: 117 offline tests passed on Node 25.2.1 (2026-10-28). Existing six adapters, automatic inventory discovery, atomic cache storage and saved records are retained. No runtime dependencies added.

## Phase 1 — lexical retrieval
Implemented NFKC tokenization, explicit morphology and configurable equivalent aliases, quoted phrases, technical-token boundaries, available-signal scoring (40/25/20/10/5 defaults), structured filter decisions and deterministic global ranking. Each provider contributes a bounded candidate pool (at least 100, at most 1000), then global ranking applies the user limit. Explicit filters remain mandatory. Updated previous interleaving assertions because the requested ordering changed; count, concurrency and failure assertions remain. Baseline phrase behavior remains available for benchmarks.

## Phase 2 - selective enrichment
Common enrichJob contracts, shared in-flight requests, 40-request search budget (constructor configurable), two concurrent board workers, transport timeout/size/cancellation bounds, bulk Greenhouse content for multiple unresolved records, cached richer-field preservation, and explicit incomplete-evidence diagnostics. Greenhouse bulk selection uses request count; byte-cost prediction remains unavailable without source size metadata.

## Phase 3 - additional public sources
Added SmartRecruiters PUBLIC-only list/detail APIs with offset pagination, Personio enabled XML feeds, Himalayas cursor feed, and Remotive feed. All use existing transport/cache/filter orchestration. Anonymous live adapter checks: SmartRecruiters 3 jobs; Personio empty valid XML (nonempty parsing fixture-tested only); Himalayas 20 jobs with page-budget warning; Remotive 11 jobs. 123 offline tests passed. Remotive refresh policy is six hours, Himalayas daily. Their attribution, source URLs and redistribution restrictions travel with each record. Source terms: https://developers.smartrecruiters.com/docs/posting-api ; https://support.personio.de/hc/en-us/articles/207576365 ; https://himalayas.app/api ; https://github.com/remotive-com/remote-jobs-api . GitHub leads and permitted employer pages attach in the discovery/resolution phases, not as invented postings.
