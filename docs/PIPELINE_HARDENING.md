# Pipeline reliability and performance

## Evidence and identity

`mergeJobEvidence` is shared by detail reuse, ATS enrichment and saved-job upserts.
Null/absent values mean unobserved, not removed. A newer observed value replaces an
older one; a missing summary value retains previous evidence. Complete descriptions
survive snippets. Observed employer names take precedence over board identifiers.
`fieldEvidence[field]` retains `observedAt`, source and a `retained` flag. Legacy
records with no timestamp remain undated; saving them does not invent a field
observation time. `savedAt` records persistence time independently.

An internal `removedFields` array explicitly retracts supported fields; description
and date companion fields are cleared together. This is an adapter/storage contract,
not a new CLI argument. Evidence merging does not turn an old field into a fresh
source observation. Existing detail/snapshot retention boundaries still apply.

Structured employer pages select JobPosting records using canonical source URLs
and comparable numeric identifiers. Record order does not establish identity.
Conflicting or ambiguous records remain unsupported. Single-job pages without an
explicit identity remain supported. Microdata follows the same selection rules.
An ambiguous page cannot redirect resolution to an unrelated ATS link; only a
unique recognized ATS target can be followed from a page without identity conflict.
Resolution parser version 3 also invalidates old GitHub-derived posting snapshots,
without discarding unrelated ATS caches.

Indeed parses its known embedded JSON sources independently, never executes remote
scripts, and retains the existing bounded extraction/traversal limits. Stable IDs
merge complementary records. Conflicting titles/employers quarantine the identity;
contradictory structured filter attributes remain unknown until independently resolved.

## Collection and filtering

Lever, SmartRecruiters and Himalayas handle malformed page schemas in the same
per-page recovery path as transport errors. A later failure retains prior jobs and
reports incomplete coverage. An invalid first response is an error, never an empty
successful search. Cancellation still aborts the operation.

Greenhouse employer metadata is resolved independently of posting freshness, only
when requested company evidence is missing. Validated names persist in inventory
metadata and reconcile inferred posting labels without refreshing the list or
changing its observation time. Metadata requests remain bounded; unresolved boards
produce partial company-coverage warnings and short-lived partial exact results.

Description completeness and filter completeness are separate. Missing supported
attributes can trigger selective detail enrichment even for a complete description.
Complete descriptions do not cause redundant bulk-content requests. Unsupported
applicant/verification criteria stay unknown. Cached descriptions are checked
before network exploration limits; budgets count actual detail requests.

Normal experience inference remains labeled; strict mode requires structured
evidence. Population/reporting phrases do not establish rank. Explicit contradictory
rank evidence still rejects entry-level results. Unquoted entry-level keyword
phrases recognize clear early-career title variants while retaining every occupation
term. Quoted phrases preserve literal token requirements. This lexical expansion
does not silently add an experience constraint.

## Caching and scheduling

Exact ATS search caches use policy version 2, retrieval version 8, filter version 3,
relevance version 3 and the parser version. Source keys include effective filters,
limits/pages and collection/enrichment budgets, excluding unrelated provider
selection. Parser-dependent providers can additionally version their own snapshots.
Existing saved records and ordinary ATS snapshots remain compatible.

Complete exact results retain a maximum 10-minute TTL; partial/stale results retain
a maximum 3-minute TTL. Manifest revisions, membership, source retention and job
expiry still bound reuse. Rolling-date searches now add a next-transition deadline
over **all visited candidates**, including rejected/future postings. Instant dates
can enter at publication and leave at publication plus the requested window.
Calendar dates use the existing UTC−14..UTC+14 uncertainty envelope: entry at day
+38 hours and exit at day−14 hours plus the requested window. Reaching any possible
transition invalidates exact reuse. Final returned dated jobs are also evaluated
at current time. Missing dates never gain fabricated precision.

Board observations accumulate in a Map keyed by region/board/domain, preserving
last-write metadata and two-worker collection without repeated accumulated-array
scans. Global concurrency remains unchanged. Public-host start reservations are
atomic per host. HTML requests serialize per host rather than across unrelated
hosts, retaining shared global bounds, cancellation, delays and response caps.

An HTML denial immediately prevents queued same-host dispatches in that client.
Dispatch preflight also checks persisted provider cooldowns. Denials are not
retried; the cooldown is at least 15 minutes or a longer Retry-After. Already
in-flight requests across processes cannot be recalled by a later denial.

Diagnostics separate API/index and HTML attempts, logical calls and retries.
Attempts increment at the transport boundary, including failed requests. Unknown
instrumentation/timing is displayed as unavailable. Progress and diagnostics remain
on stderr; structured stdout remains unchanged. Stage timings can overlap.

## Controlled measurements

Offline Windows / Node 25.2.1 measurements on 2026-10-29. These are fixtures, not
live coverage claims or CI time thresholds. Board runs use the real collector with
fresh in-memory snapshots and one Engineer per board, excluding HTTP/filesystem IO.

| Boards | Before Map, ms | After Map, ms | Before comparisons | After comparisons |
| ---: | ---: | ---: | ---: | ---: |
| 500 | 156.88 | 68.89 | 124,750 | 0 |
| 1,500 | 959.51 | 125.52 | 1,124,250 | 0 |
| 3,000 | 3,548.09 | 211.15 | 4,498,500 | 0 |

Reproduce with `node scripts/board-performance.js`. Regression tests bound work,
not machine-specific elapsed time. All boards retain their query observations.

The existing 130-board / 4,160-posting separate-process benchmark retained 25
results: cold 1,859 ms / 120 mock requests; immediate repeat 608 ms / **0 requests**,
no repeated enrichment, with the original 66 stale-board warnings. The preceding
checkpoint measured 1,888 / 614 ms with the same 120 / 0 requests: warm cache was
already fast without date filters, so no universal warm-latency improvement is claimed.
HTML CLI cold collection measured 1,322 ms / 2 requests; warm p50/p95 530/542 ms,
all zero requests. Timings include separate Node process startup.

With a synthetic 100 ms pending LinkedIn response, independent-host dispatch
latency changed from 134.60 ms to 0.64 ms. Same-host public request gaps changed
from 1,202.06 / 0.66 ms to 1,207.59 / 1,200.79 ms. Both comparisons used the original
transport implementations from the baseline commit and fake transports, with no sockets.

The small early-career fixture improves recall from 1/5 to 5/5 positive titles,
retaining negative occupation/rank examples. These provisional labels do not
establish production recall. Two synthetic near-limit shards (30.57 MiB combined)
peaked at 157.40 MiB RSS from a 57.79 MiB baseline; this is not a global heap bound.

## Remaining limits and validation

The deterministic suite covers these contracts and existing providers, exports,
saved jobs, progress, cache corruption, retries and cancellation. Use `npm test`,
`npm run lint`, `npm run benchmark`, `npm run benchmark:cache` and
`npm run benchmark:html`. The existing GitHub Actions Node 20/22/24 Windows/Ubuntu
matrix discovers the added tests automatically; hosted CI was not triggered locally.
Final local verification passed 241 tests (zero failures/skips) on each of Node
20.20.2, 22.23.4, 24.22.1 and 25.2.1 on Windows. Syntax lint and all three required
benchmarks passed; npm audit reported zero vulnerabilities. Linux execution remains
the responsibility of the existing CI matrix and was not claimed as a local check.

Same-query ATS cold followers retain the existing two-second bounded lock wait;
a longer owner reports busy to the follower without duplicate collection. An
orphaned saved-store lock still requires confirmation that no writer is active
before manual removal. Those intentional policies were reproduced, not redesigned.
External archive contracts, current live permissions and exhaustive employer coverage
were not revalidated through live scraping. Large-shard memory remains dependent
on content size; no database/framework change was justified by the controlled probe.
No dependencies, credentials, setup commands or public CLI flags were added.
