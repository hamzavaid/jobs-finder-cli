# ATS engineering validation

> Historical record of the original six-provider implementation. Current behavior, benchmark results and source expansion are documented in [PIPELINE_IMPROVEMENTS.md](PIPELINE_IMPROVEMENTS.md) and [ATS_ARCHITECTURE.md](ATS_ARCHITECTURE.md).

Validated 2026-10-27. Implementation follows ten sequential phases with a descriptive
Git commit per phase. All application and test code is JavaScript; no credentials,
paid services, required accounts, proxies or company registry were added.

## Delivered

Greenhouse, Lever (global/EU) and Ashby public API adapters run through the existing
`jobs find` architecture. Company discovery, validation, refresh scheduling, three
cache layers, local evidence-aware filtering, bounded concurrent collection,
progress reporting, cancellation and recovery require no preparatory commands.
The existing HTML providers, saved-job schema and unrelated commands remain.

## Deterministic validation

The baseline had 73 passing tests. The expanded suite covers adapters and schema,
CDX decoding/cursors, URL safety, HEAD fallback, Common Crawl/public-scan fallback,
temporary versus invalid boards, all cache layers, concurrent processes, corruption,
expired/stale data, actual CLI cold/warm runs, strict/unknown filters, pagination,
sorting, duplicate hints, partial failures, body timeouts, Retry-After, concurrency,
TTY/CI output, SIGINT and legacy-provider regressions.

Standard CI never accesses job sites or discovery services. Clean installation and
the existing syntax lint are retained. The workflow targets Node 20/22/24 on Ubuntu
and Windows, uses immutable official action revisions and read-only permissions,
and validates all six names in offline CLI checks. Hosted workflow execution itself
is not claimed in this session.

Final results: **117 tests passed, 0 failed, 0 skipped** on Windows with Node
20, 22, 24 and the installed Node 25 runtime. Clean `npm ci`, recursive syntax lint,
workflow/documentation checks and `git diff --check` passed. `npm audit` reported
zero known vulnerabilities; no runtime dependencies were added. The existing
transitive whatwg-encoding deprecation warning remains a maintenance item.

Final test counts/runtime results and final checks are recorded in
[ATS_PIPELINE_AUDIT.md](ATS_PIPELINE_AUDIT.md).

## Live evidence and measured performance

| Check | Observed result |
| --- | --- |
| Greenhouse adapter, provider example board | 18 normalized postings; successful detail with original publication date and observed employer |
| Lever adapter, provider example board | 10 normalized postings |
| Ashby adapter, provider example board | 66 normalized postings |
| Automatic cold discovery, no seeded inventory | Live matches from all three sources; Common Crawl/public-scan fallbacks used during Wayback outages |
| Bounded cold samples | 3 boards per provider; 797 Greenhouse, 47 Lever and 31 Ashby cards processed; two accepted matches each in provider checks |
| Actual CLI Software Engineer search | Five accepted jobs after 3,898 cards across 93 board API pages; warnings disclosed partial discovery/collection |
| Measured cached-discovery run | 3,943 ms; three HTTP calls with a three-board refresh budget |
| Immediately repeated exact search | 113 ms; zero HTTP calls; all three ATS exact caches hit; partial warnings preserved |
| Deterministic CLI fixture run | About 5,963 ms cold versus 739 ms warm, including child-process startup and enforced request spacing; warm HTTP calls: zero |

These are observations from one environment and bounded inventories, not throughput
guarantees or exhaustive platform totals. The combined live limit can omit a selected
source from displayed rows even when it collected matches successfully. Example
board names were used only for separate smoke inputs, never as production discovery
seeds. Generated live/cache files were kept out of Git.

Wayback requests timed out or returned 503 in the recorded run. Common Crawl was
intermittent; anonymous public-scan search returned useful current board URLs. The
implementation still treats Wayback as primary and retains resumable cursors.
The existing LinkedIn live check had parsed cards; Indeed/Glassdoor remained 403.

## Independent final review

A separate pass reviewed all pipeline modules, adapters, schema handling, CLI and
HTTP changes, tests, workflow and documentation. Findings fixed before delivery:

- Preserve Lever's completed pages if a later request fails; propagate restrictions
  into persistent provider backoff instead of discarding the first page.
- Refresh a cached truncated board when a later search asks for more pages.
- Avoid repeatedly fetching Greenhouse details that were already enriched; never
  treat non-string API titles as real titles.
- Bound exact-cache verification to two decoded posting shards, as well as collection.
- Keep old rows' observation timestamps during partial merges and bound search-cache
  TTL at the earliest row-freshness boundary.
- Recheck cooldowns for already-queued requests after receiving Retry-After.
- Recover interrupted stale-lock recovery files; finish atomic writes and clean signal
  listeners during cancellation.
- Keep optional cache I/O failures from erasing successfully collected jobs, and keep
  cache-hit reporting from claiming the old pages were newly scanned.

## Remaining limits and recommended follow-up

1. No ATS publishes a complete unauthenticated employer directory. Archive/public
   scan coverage can miss new or unindexed companies. Budgeted passes and unavailable
   indexes produce partial coverage; an all-index outage on a cold installation can
   still prevent discovery. Never replace this with a fabricated company list.
2. API payloads omit some employer labels, seniority and workplace information. Strict
   filters can exclude many jobs. Lever creation time is not public posting time;
   date searches can legitimately return no Lever matches.
3. Greenhouse descriptions/date enrichment cost extra bandwidth. Large searches can
   hit board/page/detail or response-size budgets. Warnings and observation times
   disclose incomplete coverage; no unvisited posting is declared closed.
4. Exact-cache verification reads referenced shards to ensure revision correctness.
   Large cached inventories still incur disk I/O. A future transactional metadata
   index could reduce that cost if real measurements justify the complexity.
5. JSON snapshots use atomic replacement, not a power-loss durability guarantee.
   Cache data is disposable and recoverable; saved job data remains separate.
6. Refresh/request limits apply per process. Locks protect shared cache writes, but
   multiple independently launched CLI processes can duplicate network collection.
7. Native TTY rendering is intentionally minimal; non-interactive users receive clean
   result streams and bounded final diagnostics. Lint is syntax-only; no claim of
   exhaustive static/security analysis is made.
8. Continue periodic dependency audits, run the committed hosted CI, and add small
   authorized API fixtures when payloads change. An optional generated public board
   snapshot could help cold starts if a trustworthy, uncurated source is available;
   it must remain replaceable by live discovery and must not become a fixed registry.
