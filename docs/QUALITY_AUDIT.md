# Quality audit

Audit date: 2026-10-27. Scope: every source module, CLI entrypoint, README,
package manifest/lockfile, all 31 existing tests and four HTML fixtures.

Baseline: 31/31 tests pass; existing syntax checks pass. On Windows use
`npm.cmd` where PowerShell execution policy disables `npm.ps1`. The initial
dependency advisory request failed because registry network access was unavailable;
this is not evidence that dependencies are free of vulnerabilities.

| ID | Severity | Root cause and observed issue | Proposed solution |
| --- | --- | --- | --- |
| Q01 | High | `doctor` declares `--website` twice; Commander cannot construct the CLI reliably. Unit tests never invoke the entrypoint. | Remove duplicate; subprocess-test every command. |
| Q02 | High | Unknown formats in `job`/`saved` fall through to table; `job --delay` and saved limits skip validation. | Centralize shared validation and test invalid inputs. |
| Q03 | High | HTTP start times race under concurrent calls; timeout excludes body errors; network/timeouts never retry; failed responses are not disposed. | Serialize the shared client, bound retries, cover headers and body with timeout, cancel unused bodies. |
| Q04 | High | Challenge heuristic exempts pages containing stale card markers; login/unknown markup can become empty success. | Detect explicit challenge/login documents and reject unrecognized search pages; accept explicit no-results markers. |
| Q05 | High | Date evaluator accepts invalid/future instants and unknown Glassdoor criteria would inherit LinkedIn facets. Coarse Indeed date buckets imply stronger accuracy than available. | Explicit provider facet capabilities, conservative date handling and regression tests. |
| Q06 | High | LinkedIn parser marks every `Over N applicants` as 10+ even when N is 5. | Interpret lower bounds conservatively. |
| Q07 | High | Concurrent saves overwrite each other; PID-only temporary paths collide, files survive failures, legacy migration misses source-less LinkedIn rows. | Serialize in-process writes, exclusive cross-process lock with descriptive contention error, unique temporary files and cleanup. |
| Q08 | Medium | Provider branches are hardcoded throughout CLI/orchestrator; job URL selection uses substring matching; LinkedIn ID parser accepts foreign hosts. | Provider registry with validated detail inputs and normalized schema. |
| Q09 | Medium | Indeed detail ignores JSON-LD graphs, location, employment and salary; empty detail markup is marked fetched. | Shared structured-data parser; validate recognized detail content. |
| Q10 | Medium | Detail or later-page failure discards previously collected results from that provider. | Return partial results with explicit provider warnings; stop provider on restricted access. |
| Q11 | Medium | Stats count is quadratic, missing source is reported unknown for legacy LinkedIn rows; schema validation permits malformed stored rows. | Linear aggregation, legacy source normalization, reject corrupt stores without overwriting. |
| Q12 | Medium | Exports omit description/salary; unknown formats silently succeed; terminal control characters from scraped text reach table output. | Add fields, validate serializers and sanitize table display. |
| Q13 | Medium | No CLI/export/timeout/retry/queue/concurrent-store tests or CI; lint omits three modules and tests. | Deterministic integration/regression suite, recursive syntax checks, Node compatibility matrix and separate live smoke script. |
| Q14 | Low | README says two providers/default both, installation assumes ZIP; no documented evidence of current live access. | Document three-provider behavior, exact filter limitations and verified live outcomes. |

Existing strengths: safe JSON assignment extraction without evaluation, provider-qualified
storage keys, source interleaving, explicit unknown attributes, CSV formula neutralization,
finite page/result limits and no authentication or bypass mechanisms.

Provider review: LinkedIn increments by returned card count and stops repeated IDs;
Indeed uses ten-result offsets and stops repeated IDs. Both deduplicate by provider ID,
which preserves distinct postings and cross-site attribution. Search keywords/location
are server queries, not independently verified local matches. Company filtering is local.
Neither HTML fixtures nor URL parameters prove a live provider honors a filter.

## Implementation and verification log

Phase 1: audit recorded before source changes. No failing baseline tests. Registry
advisory verification pending a successful network request.

Phase 2: repaired Q01?Q12: removed duplicate doctor option; validated local CLI
limits/formats/delays; serialized HTTP including body timeouts, bounded transient
retries and disposal; rejected unknown search markup; introduced provider descriptors,
a shared search loop and normalized nullable schema; preserved partial results with
warnings; corrected applicant lower bounds, invalid timestamps and foreign job URLs;
added JSON-LD graph detail extraction; serialized/locked atomic persistence with
cleanup, legacy migration, schema validation and linear stats; extended exports and
sanitized table control characters. Prototype-chain choice names also now reject.
Coarse Indeed date buckets are only considered a facet when they exactly equal the
requested window. Baseline 31 tests still pass; nine regression groups added, 40/40
pass. Cross-process store contention fails explicitly instead of silently losing data.
