# Indeed and Glassdoor provider pipeline

Subsequent filter semantics, title evidence, keyword validation and versioned cache
updates are recorded in [FILTER_ACCURACY.md](FILTER_ACCURACY.md). Its rules supersede
the filtering details and historical test totals in this implementation-stage report.

Implemented against the supplied [specification](INDEED_GLASSDOOR_TECHNICAL_PIPELINE.md).
See [access assessment](PROVIDER_ACCESS.md) and [baseline audit](INDEED_GLASSDOOR_AUDIT.md).
No API keys, accounts, paid services, proxies or new dependencies are required.

## Execution and access

`find` normalizes the existing arguments, applies the source policy, checks the
exact query cache, checks the separate block cooldown, verifies robots, then reads
permitted HTML pages. Only validated on-page data enters filtering and ranking.
`job`, `doctor --probe` and optional smoke tests apply the same source policy.
Glassdoor is restricted by default. An internal embedding grant must specify
`accessPolicy.Glassdoor = {mode:'public-html', evidence:'documented reference'}`;
this records an independently established permission, it does not obtain it.
Tests explicitly label grants as synthetic fixtures. There is no CLI override.

Indeed uses its existing URL hints and follows only actual next-page links. It
does not guess offsets after an unrecognized link. Glassdoor retains its SEO route
and public next links; client-only pagination produces a partial outcome. Neither
implementation uses internal GraphQL, CSRF/session extraction, browser automation
or alternate routes after denial. The third-party repositories in the specification
remain design references, not runtime dependencies or evidence of permission.
No structured adapter was enabled because no authorized contract was available.

## Results and filtering

Source stats expose `status`: `ok`, `empty`, `partial`, `blocked`, `restricted`,
`schema_changed`, `rate_limited`, `timeout` or `failed`. Fatal provider errors carry
the same classification; an all-failed aggregate includes provider diagnostics.
Partial results retain `stopStatus` and warnings. The existing serialized job-array
output is unchanged; CLI statuses and browser links go to stderr. TTY activity
continues to use one row per website. Other sources continue after a denial.

`complete` means the observed pagination ended within the requested scope; it is
not proof of site-wide coverage. Result/page/detail budgets, repeated URLs/cards,
client-only loading and later failures mark coverage partial. HTTP 200 challenges
are blocked; unknown markup is schema_changed. Only recognized empty components
or a valid parsed page whose jobs fail filtering can yield an empty search.

| Find argument | Indeed | Glassdoor |
| --- | --- | --- |
| `--search` | Server `q`; existing provider text semantics | SEO keyword; existing provider text semantics |
| `--company` | Query hint plus exact normalized observed employer | Exact normalized observed employer |
| `--location` | Server `l` plus local observed substring | Local observed substring; incomplete geographic scope warning |
| `--date` | Outward-rounded 1/3/7/14-day URL hint; exact local date evidence required | Local timestamp evidence required |
| `--remote`, `--workplace` | Partial URL hints; observed enum required | Observed enum required |
| `--experience` | Partial URL hint; observed classification required | Observed classification required |
| `--employment` | Known `jt` hints; observed type required | Observed type required |
| `--under`, `--verified` | Unsupported; unknown values excluded for true and false | Unsupported; unknown values excluded for true and false |
| `--sort` | Server date hint plus shared local ranking | Shared local ranking; unknown dates do not become newest |
| `--strict` | Reject unknown/unconfirmed criteria | Reject unknown/unconfirmed criteria |
| `--details` | At most 25 selective detail requests; cached by source ID | Same, when access is permitted |
| `--pages`, `--limit`, `--delay` | Existing budgets; no guarantee of filling limit | Same |
| `--website` | Existing case-insensitive multiple-value selection | Same |
| `--save`, `--format`, `--output` | Existing persistence and table/JSON/JSONL/CSV behavior | Same |

These sources no longer count a query parameter alone as proof of a filter match.
Date-only values retain timezone uncertainty; relative ages are text, not invented
timestamps. Indeed `dateOnIndeed` is retained as indexedAt, distinct from postedAt.
Explicit hybrid metadata takes precedence over a remote boolean, which alone is
ambiguous. Salary labels preserve source-displayed versus Glassdoor-estimated
attribution. JSON-LD baseSalary is represented as employer-provided metadata,
not a guarantee of actual compensation. Existing source-qualified store IDs remain.

## Cache schema and concurrency

CacheManager adds three record kinds using the existing version-1 atomic envelope:

| Kind | Key / content | Freshness |
| --- | --- | --- |
| html-search | Stable hash of source, normalized criteria, public transport revision and parser version; normalized jobs and source stats | 10 minutes complete; 3 minutes partial |
| html-detail | Source, job ID, parser version; parsed normalized job | 6 hours |
| html-policy | Origin robots text or source block status and retryAt | Robots 6 hours; denial at least 15 minutes or longer Retry-After |

Keys exclude unrelated provider selections, output destinations, format and saving.
Filters, sort, page/limit/detail budgets and parser version remain relevant. Cache
hits re-evaluate rolling dates using the current clock and retain original job
observation timestamps. Changed parser version (now 5), corruption and expiration
cause refresh. Previously successful jobs can be served for up to 24 hours from
their query snapshot during failed refresh, with `cacheStatus=stale`, partial status
and the refresh reason. A denial never becomes a cached successful empty search.

Identical misses hold a source/query collection lock and recheck the cache after
acquisition. All writes reuse the existing temp-file/rename and lock recovery.
Cancellation propagates instead of being swallowed as partial success; completed
atomic writes are retained. Different queries share detail and policy caches.
Expired HTML artifacts are pruned at most daily on cache misses; valid exact hits
skip maintenance. Active long Retry-After records are retained. Unavailable cache
storage produces a warning while freshly parsed results remain usable.
No background process or cache-maintenance command is added.

## Validation and performance evidence (2026-10-29)

Baseline had no persistent HTML query cache. No historical wall-clock measurement
was taken; do not compare this fixture measurement to earlier live ATS timings.
`npm run benchmark:html` uses one synthetic Indeed DOM posting, mocked fetch,
real CLI/filter/output/cache code, a temporary directory and six separate Node
processes. It makes no actual internet requests.

Measured on this Windows workspace (Node 25.2.1, with other checks running):

| Execution | Wall time | Mock transport calls | Result |
| --- | ---: | ---: | --- |
| Cold | 1,883 ms | 2 (robots + search) | 1 job, no exact hit |
| Five immediate repeats | 854–1,097 ms; p50 1,050 ms; p95 1,097 ms | 0 each | 1 job each, exact hits |

These are measurements, not CI timing assertions or a live throughput promise.
Warm execution includes CLI/module/process startup. Tests assert zero repeated
requests and stable results, not an environment-dependent speed threshold.
Counters distinguish public HTML requests from API/index requests. Parser rejects,
detail-cache hits, pages, source status and duration are retained in source stats.

Live smoke: `node scripts/live-smoke.js Indeed Glassdoor`, keyword `accountant`,
US domains, Windows workspace, 2026-10-29. Indeed returned HTTP 403 and zero verified
jobs; collection stopped. Glassdoor returned policy-restricted with zero verified
jobs and no listing request. No successful live extraction is claimed for either.
The exact failing Indeed route was not captured in that diagnostic run; do not
infer that a search page was reached rather than its preceding robots request.

Offline coverage includes both sources' original synthetic DOM/structured fixtures,
identity conflicts, salary attribution, bounded assignments, hybrid/index dates,
query encoding, unknown filters, partial pages, robots denial, cooldowns, corruption,
parser invalidation, rolling dates, concurrent queries, detail reuse, cancellation,
CLI structured output, saved records and separate-process warm-cache measurements.
Final full suite: 184 passed. Provider compatibility checks passed on Node 20/22/24;
dependency audit: zero vulnerabilities. No hosted workflow run is claimed.
The existing pinned CI workflow already runs install, lint, full tests and benchmark
on Windows/Ubuntu with Node 20/22/24; no live collection was added to CI.

## Remaining limits

Glassdoor automation needs provider permission. Indeed remains externally blocked
in the observed environment. No new live selector/schema validity is claimed.
Only tested schema variants are parsed; arbitrary Apollo stores or private API
payloads remain unsupported. Geographic substring matching cannot disambiguate
all cities, and a local filter cannot recover jobs outside the server's scope.
Incomplete cards remain unknown rather than fabricated matches. Broader synthetic
fixture variants and provider-authorized payloads are appropriate future additions.
