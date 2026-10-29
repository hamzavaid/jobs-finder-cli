# ATS extension audit and implementation record

> Historical record of the original six-provider implementation. Current behavior, benchmark results and source expansion are documented in [PIPELINE_IMPROVEMENTS.md](PIPELINE_IMPROVEMENTS.md) and [ATS_ARCHITECTURE.md](ATS_ARCHITECTURE.md).

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

5. Integrated automatic discovery/collection and all three cache layers into find, extended defaults to six sources, and retained explicit HTML-provider regressions. Added internal FilterEngine and ProviderRegistry. First-run fixture tests need no seeded boards; identical repeat searches make zero API/index requests. Full suite: 94 tests pass. URL utility reports that ATS APIs have no global search URL; saved/export/stats recognize all six sources.

6. Selected providers now run concurrently with stable interleaving. API transport bounds global/per-host requests and response bodies, rejects redirects, supports timeouts/cancellation, retries transient failures with exponential jitter and honors Retry-After. Collection reads only two posting shards at once, retains bounded top results, schedules oldest boards first and persists at board granularity. API/concurrency and pipeline tests pass. HTML retains its separate serialized lane (maximum total HTTP concurrency: five).

7. Added native throttled TTY-only progress on stderr, collection/cache/discovery statuses, bounded diagnostic summaries and CLI SIGINT cancellation. Redirected/CI streams never animate. Three progress/lifecycle tests pass, including an active discovery cancellation with exit 130 and clean structured stdout. Existing HTML client also supports caller cancellation.

8. Hardened stale fallback, partial page unions, provider-level persisted backoff, exact-cache invalidation, automatic pruning and optional cache-write failures. Cross-source duplicate hints retain distinct records. Added recovery regressions; cancellation listeners are cleaned up. Live archive smoke: Wayback timed out/503; Common Crawl timed out, so end-to-end live cold discovery is unverified in this environment.

9. Expanded deterministic QA to 113 tests and retained Node 20/22/24 Windows/Ubuntu CI. Added real CLI cold/warm subprocess tests, API transport, discovery fallbacks, cache recovery, progress, filtering and failure-isolation regressions. Optional live smoke remains separate. Live adapters normalized Greenhouse 18, Lever 10 and Ashby 66 postings on example boards; a Greenhouse detail exposed its publication date. Automatic discovery returned matches from all three providers with explicit partial coverage. The actual find CLI returned five Software Engineer matches after scanning 3,898 cards. A measured repeat over automatically discovered data took 113 ms with zero HTTP calls; its preceding bounded run took 3,943 ms and three HTTP calls. No company registry or new runtime dependencies were added.

10. Completed user-focused README, architecture/cache/discovery documentation and
engineering validation summary. A separate final review corrected later-page Lever
failure retention, larger page-cap cache refresh, non-string title handling,
Greenhouse detail reuse, shard memory limits, freshness-boundary exact-cache TTL,
queued Retry-After handling, stale recovery guards and optional cache-I/O behavior.
Regression tests were added for the confirmed issues.

Final suite: **117 passed, zero failed/skipped** on Node 20/22/24/25 on Windows.
Clean installation, recursive syntax lint, dependency audit (zero known advisories),
workflow YAML/pinned-action checks, complete CLI flag documentation/link checks,
and Git whitespace validation pass. Runtime dependencies remain the original three.
GitHub-hosted Ubuntu/Windows CI is configured but was not executed here. Live index
outages, partial coverage, unsupported attributes, per-process network limits and
other remaining limits are disclosed in [ATS_VALIDATION.md](ATS_VALIDATION.md).
