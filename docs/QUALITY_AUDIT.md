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

Phase 3: added Glassdoor provider, DOM and JSON-LD contracts, conservative local
filtering, robots-checked public-link pagination and descriptive blocked/markup
errors. Six new test groups; 46/46 pass. See GLASSDOOR_RESEARCH.md for primary
sources and limitations. Live Node request returned HTTP 403; no live extraction
claim is made. npm registry advisory check succeeded: zero known vulnerabilities;
installing the free robots-parser dependency also reported zero vulnerabilities.

Phase 4: all three sources now default in find/url; provider registry dispatches
search/detail, saved/export/stats accept provider filters, doctor probes each selected
provider independently. Posting URLs validate host/protocol and reject source conflicts.
Actual CLI subprocess checks exposed an additional high-priority defect (Q15): the
Commander variadic collector spread a string into characters (`Glassdoor` became
`G`, `l`, ...). Fixed by treating each parser value as a scalar or array explicitly.
Regression tests cover repeated, comma-separated, mixed-case and multiple arguments.
51/51 tests and existing lint pass. The default-provider assertions were intentionally
updated from two to three; explicit two-provider behavior remains tested.

Phase 5: clean npm ci succeeds; all 66 offline tests pass on the installed Node
25 runtime and a separately downloaded Node 20 runtime. Recursive syntax lint covers
source, CLI, scripts and tests. CI runs installation/lint/tests/CLI smoke commands on
Node 20/22/24 with Windows and Ubuntu, read-only permissions and immutable official
action revisions. CI itself has not run on GitHub during this session. Optional live
smoke script is outside standard test discovery and never runs in CI. Live results:
LinkedIn parsed three normalized cards from one page; Indeed and Glassdoor each
returned HTTP 403 and stopped. No working Indeed/Glassdoor extraction claim is made.

## Final review findings and disposition

| ID | Severity | Root cause | Resolution |
| --- | --- | --- | --- |
| Q15 | High | Variadic argument collector spreads individual strings into characters. | Fixed collector shape handling; actual CLI subprocess regressions. |
| Q16 | High | LinkedIn generic verified badges can describe an employer; negative card badges can match a positive substring. | Require explicit job-specific verification evidence; test employer and negative cases. |
| Q17 | High | Day-precision dates were never checked for definite old/future contradictions. | Conservative UTC-14 through UTC+14 interval evaluation, with boundary regressions. |
| Q18 | High | Glassdoor single JobPosting fallback could attach another posting's metadata to a requested ID. | Reject a mismatched verifiable listing ID; test refusal to merge. |
| Q19 | Medium | Taxonomy substring checks interpret International as internship and Associate Director as associate; combined employment types collapse to one. | Word boundaries, seniority specificity, and membership across explicit employment values. |
| Q20 | Medium | Generic Indeed card-container marker permits unknown schemas to look like successful empty results. | Require explicit no-results evidence when parsing yields no cards; regression fixture. |
| Q21 | Medium | Structured descriptions are reprocessed by a tag regex, leaving entities encoded; URL IDs can come from query text; stored IDs reach tables unsanitized. | Reuse structured text decoding, validate posting paths, sanitize every table field. |
| Q22 | Low | Transitive whatwg-encoding dependency is deprecated. | Retained current Cheerio to avoid unrelated migration; npm audit reports zero known advisories. |

Phase 6: comprehensive README and engineering summary completed. Q01–Q21 are
resolved; Q22 is a documented maintenance item. Original CLI construction failure
was independently reproduced with Commander reporting conflicting `--website`
declarations. Final deterministic suite: **73/73 pass** on Windows with Node
20/22/24/25. Clean installation, full syntax lint, advisory check and diff whitespace
check pass. Workflow YAML parses; manual review confirms read-only permissions,
immutable official action references, disabled persisted checkout credentials,
bounded jobs and no live scraping. Hosted Ubuntu/Windows workflow execution is
pending a future push/PR; it is not claimed to have run here.

Final live checks repeated after parser fixes: LinkedIn parsed three cards;
Indeed/Glassdoor returned HTTP 403. Remaining limitations are external access,
public pagination availability, local Glassdoor location matching, synthetic fixture
provenance, syntax-only lint, and manual stale-lock recovery. See
[ENGINEERING_SUMMARY.md](ENGINEERING_SUMMARY.md) for detailed evidence and follow-up.
