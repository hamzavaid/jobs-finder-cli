# ATS extension audit and implementation record

Date: 2026-10-27. Baseline: clean Git worktree, 73 offline tests pass and recursive
syntax lint passes. Reviewed CLI/argument parsing, provider registry/descriptors,
search orchestration, HTTP client, evidence-aware filters, nullable schema,
persistence, exports, tests, workflow and existing documentation.

## Reuse and required changes

| Priority | Finding | Implementation decision |
| --- | --- | --- |
| High | Existing descriptors assume HTML search pages, not company-scoped JSON. | Add API adapters and route them through CollectionManager while retaining HTML adapters. |
| High | No employer registry can enumerate these APIs. | DiscoveryManager extracts boards from public URL indexes, validates current endpoints and persists additive inventories. No company list is bundled or maintained. |
| High | HTTP queue is serial and has no caller cancellation, Retry-After or JSON support. | Keep HTML behavior compatible; add a shared bounded API transport with allowlisted destinations, body limits, timeouts and cancelable scheduling. |
| High | Filtering assumes server keyword/location search; ATS filtering must be local. | FilterEngine adds local keyword/location handling and reuses evaluateJob for evidence-aware criteria. |
| High | updated_at/createdAt and Ashby's remote boolean have misleading semantics. | Keep modification/creation timestamps separate, use trustworthy publication dates only, prefer explicit workplaceType over isRemote. |
| High | No persistent discovery/job/search caches exist. | CacheManager stores versioned atomic JSON records in the OS cache directory, with cross-process locks, corruption recovery and TTLs. Saved jobs remain separate. |
| Medium | Existing orchestrator runs providers serially. | Concurrent selected providers with bounded board workers/global requests, stable output order and failure isolation. |
| Medium | Huge discovery/collection work could delay every search. | Resume bounded crawl/collection batches automatically; keep coverage metadata and partial-result warnings. Cache inventories and full board payloads independently of search filters. |
| Medium | No terminal progress or Ctrl+C lifecycle. | ProgressReporter writes throttled TTY-only status to stderr; CLI owns AbortController and signal cleanup. Completed cache writes remain valid. |
| Medium | Existing tests assume exactly three default sites. | Extend defaults to six; preserve explicit legacy-provider regressions and add isolated ATS integration fixtures. |

## Internal component boundaries

- ProviderRegistry: existing providers.js facade backed by registered adapters.
- DiscoveryManager: archive cursors, slug extraction, endpoint validation and inventory merge.
- CacheManager: filesystem envelopes, locking, freshness, recovery and pruning.
- CollectionManager: selected-provider routing, board refresh, search-cache checks and coverage.
- FilterEngine: shared evidence checks plus local ATS query matching/sorting.
- ProgressReporter: lifecycle/status rendering only; never owns collection behavior.

JSON sharding by provider/board avoids a new SQLite/native dependency. Cache files
are hashed internal keys; archive URLs are never fetched as destinations. API URLs
are constructed from validated identifiers on fixed HTTPS hosts. API redirects are
rejected. Metadata distinguishes complete board fetches, stale fallback, partial
inventory coverage and unknown attributes; no search marks postings closed.

## Research

Primary references: [Greenhouse](https://docs.greenhouse.io/job-board),
[Lever](https://github.com/lever/postings-api),
[Ashby](https://developers.ashbyhq.com/docs/public-job-posting-api),
[Internet Archive CDX](https://github.com/internetarchive/wayback/tree/master/wayback-cdx-server).
Studied [job-boards](https://github.com/mherzog4/job-boards) and its discovery source:
archive URL enumeration, first-segment extraction, candidate deduplication and live
API checks. This project implements those general algorithms directly in JavaScript;
it does not execute Python or adopt the reference project's curated seed list.

## Phase log

1. Repository audit and architecture recorded before implementation. Baseline passes.

2. Added dedicated Greenhouse, Lever (global/EU), and Ashby JSON adapters. Five deterministic adapter tests and lint pass. Timestamps, workplace ambiguity, malformed payloads and pagination are covered. Live API verification is pending the transport/discovery pipeline.

3. Implemented bounded, resumable CDX discovery and a public Common Crawl fallback. Candidate extraction is host-restricted; HEAD validation falls back to JSON GET only for unreliable method responses. Temporary failures preserve prior validity. Five deterministic discovery groups pass. Persistence is injected and implemented in phase 4.

4. Added OS-native cache paths, versioned/validated JSON envelopes, atomic shard replacement, cross-process locking, dead-owner recovery, corruption quarantine and automatic pruning. Six cache test groups pass, including concurrent instances and canceled lock waits. No runtime dependencies were added.
