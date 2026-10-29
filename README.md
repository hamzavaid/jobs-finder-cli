# Jobs Finder CLI (`jobs`)

Search **LinkedIn, Indeed, Glassdoor, Greenhouse, Lever, Ashby, SmartRecruiters,
Personio, Himalayas, and Remotive** from one Node.js
command. Searches work across occupations, including chefs, accountants, nurses,
electricians, and engineers.

**No API keys, accounts, paid services, proxies, subscriptions, or Python runtime
are required.** The ATS integrations use public posting APIs. Company discovery,
caching, refreshes, and cache recovery happen automatically inside `jobs find`.
There are no discovery, synchronization, initialization, or maintenance commands.

## Install and search

Requires Node.js **20+** and npm. Use a current supported Node release when possible.

```bash
git clone https://github.com/hamzavaid/jobs-finder-cli.git
cd jobs-finder-cli
npm ci
npm link
jobs find --search "Software Engineer" --website Greenhouse Lever Ashby
```

`npm link` is optional. You can use `node bin/jobs.js` instead of `jobs`, or
`npm start -- find --search "Chef"`. On Windows, reopen the terminal if `jobs` is
missing from PATH. If PowerShell blocks `.ps1` launchers, use `npm.cmd`, `jobs.cmd`,
or `node bin/jobs.js`.

```bash
jobs find --search "Chef"
jobs find --search "Nurse" --website SmartRecruiters Personio Himalayas Remotive --sort relevant
jobs find --search "Intern" --website GitHub --format json
jobs find --search "Accountant" --website Greenhouse Lever Ashby
jobs find --search "Nurse" --website LinkedIn Ashby --location "Boston"
jobs find --search "Electrician" --website LinkedIn Indeed Glassdoor Greenhouse Lever Ashby
jobs find --search "Teacher" --website Ashby --remote true --save --format json
```

Omitting `--website` selects **all ten** providers above. **GitHub** is an optional
source that resolves direct application links from public internship/new-grad lists;
select it with `--website GitHub`. Its narrower list coverage is not a general job index. Names are case-insensitive;
multiple values, comma-separated names, and repeated flags work. Duplicates are
removed while preserving the requested order:

```bash
jobs find --search "Chef" --website greenhouse LEVER Ashby
jobs find --search "Chef" --website Greenhouse,Lever,Ashby
jobs find --search "Chef" --website Lever --website Ashby Lever
```

At least one of `--search`, `--company`, or `--location` is required for `find` and
`url`. There is no default occupation. Invalid provider names and conflicting or
invalid options fail with a descriptive error.

## What happens automatically

On the first ATS search, the CLI finds public company boards, checks their current
APIs, retrieves postings, and filters them locally. It builds its own inventory;
there is no bundled or manually maintained company list. Discovery uses public
archive indexes, anonymous public-index fallbacks, and direct application links from
public job lists. Known list formats are a discovery source, not a company registry.
Selected employer-scoped ATS providers trigger discovery; global feeds do not need employer inventories. A LinkedIn-only search never starts it.

First searches can take tens of seconds or minutes, depending on archive availability,
network delays and board size. Work runs in bounded batches. **A partial-coverage
warning means the CLI searched a subset, not every employer on that platform.**
Unvisited companies and partial pages are not treated as closed jobs. Future searches
continue automatic collection when cached results need refreshing.

Identical repeated ATS/feed searches check their persisted result cache **before any
network discovery, collection or enrichment**. Valid partial results are reusable
too: their original coverage warnings and stale observation timestamps remain intact.
A cache hit does not advance the board-refresh batch.

Repeated searches reuse three independent cache layers:

| Cache | Normal refresh behavior |
| --- | --- |
| Company boards | Full discovery due after 30 days; recent discovery daily; validation around every 7 days |
| Board postings | ATS snapshots fresh for 20 minutes; Remotive six hours, Himalayas one day; only missing/stale or insufficient board snapshots are refreshed |
| Identical searches | Complete/fresh results up to 10 minutes; partial/stale results up to 3 minutes, bounded by snapshot retention, revisions and job expiry |

Short batches can span multiple searches; discovery completion means the configured
index pass finished, not that every employer worldwide was found. Failed discovery
never discards previously valid boards. Temporary failures can use labeled stale data
for up to seven days. Expired data is not presented as current. Partial-search cache
hits keep their warnings. Rolling `--date` searches re-evaluate time filters rather
than reuse potentially outdated exact results.

Small revision manifests validate repeated searches without loading every posting
snapshot. Unchanged collections renew freshness without rewriting large snapshots.
Cross-process locks coordinate searches and board refreshes, and enriched descriptions
survive lighter refreshes. Oversized Greenhouse bulk content gets a 24-hour cooldown;
individual details can continue. Individual transient failures wait five minutes,
structural/unsupported failures 24 hours. Bulk and detail budgets are separate.
Negative resolution outcomes expire automatically. Pruning runs at most daily on
collection searches; exact hits never scan cache directories.

Caches live in the operating system's user cache directory, separate from saved
jobs and the repository. Corrupt cache records recover automatically. Normal use
requires no cache configuration. Advanced/test environments can override the cache
root with `JOBS_CACHE_DIR`; this is optional.

## All `find` arguments

| Argument | Default | Meaning |
| --- | --- | --- |
| `--website <sites...>` | all ten enabled sources | Select any supported providers |
| `--search <keywords>` | none | Provider retrieval plus local token/phrase evidence; HTML matching includes observed employer/location as well as title/description; ATS/feed matching uses title/description |
| `--company <name>` | none | Normalized equality, ignoring common legal suffixes and punctuation |
| `--location <place>` | none | Server hint where available, then local contiguous-word matching over observed primary/secondary locations; no geocoding |
| `--date <duration>` | none | Integer `Nh`, `Nd`, `Nw`; 1 hour through 365 days; `1d` is past 24 hours |
| `--remote <boolean>` | any | `true`: remote only; `false`: hybrid or on-site |
| `--workplace <type>` | any | `remote`, `hybrid`, `onsite` (`on-site` alias); conflicts with `--remote` |
| `--experience <level>` | any | `internship`, `entry`, `associate`, `senior`, `director`, `executive`; aliases `intern`, `entry-level`, `junior`, `mid`, `mid-senior` |
| `--employment <type>` | any | `full-time`, `part-time`, `contract`, `temporary`, `internship`, `volunteer`, `other`; aliases `fulltime`, `parttime`, `intern` |
| `--under <boolean>` | any | Fewer than 10 applicants (`true`) or at least 10 (`false`); unknown is always excluded |
| `--verified <boolean>` | any | Explicit job verification; unknown does not mean false |
| `--limit <n>` | `25` | Combined result cap, integer 1–200; not a promised minimum |
| `--pages <n>` | `5` | Page cap per paginated board/provider, integer 1–20; does not set the company-discovery batch size |
| `--delay <ms>` | `1200` | Minimum request-start spacing, integer 750–30000; archive services can impose larger minimums |
| `--sort <order>` | `recent` | `recent` or `relevant`; global date-first or relevance-first ranking, with stable tie-breaking |
| `--details` | off | Enrich candidates; request full Greenhouse descriptions |
| `--strict` | off | Require metadata for experience instead of title-only evidence; unknown server facets are excluded in both modes |
| `--save` | off | Upsert accepted jobs into the local saved-job store |
| `--format <type>` | `table` | `table`, `json`, `jsonl`, `csv` |
| `-o, --output <file>` | stdout | Write output and create missing parent folders |

Boolean values require a value and accept `true/false`, `yes/no`, or `1/0`, ignoring
case. Employment and experience are independent: entry-level does not imply internship.

```bash
jobs find --search "Accountant" --website Greenhouse Ashby --date 7d --strict
jobs find --search "Nurse" --website Ashby --workplace hybrid --employment full-time
jobs find --search "Chef" --website Greenhouse --details --format json -o results/chefs.json
```

## Data accuracy and provider differences

Unknown attributes are `null`; the CLI never invents applicant counts, verification,
salary, seniority, or posting dates. Strict mode checks requested criteria, not every
optional field. It does not guarantee that a vacancy remains open after a cached fetch.

| Provider | Important limits |
| --- | --- |
| Greenhouse | Lightweight titles are followed by selective description enrichment when needed; multiple unresolved records can use bulk content. Add `--details` for fuller candidates. Date filtering fetches candidate details for the original publication date; modification time is kept separately. Detail work is bounded and incomplete coverage is reported. |
| Lever | Supports global/EU boards and public API pagination. Creation timestamps are retained separately; they are not treated as public posting dates. `--date` excludes jobs without a trustworthy publication date. |
| Ashby | Uses published dates and explicit workplace metadata. Hybrid jobs can also have `isRemote=true`; that boolean alone does not establish remote-only work. Unlisted postings are excluded. |
| SmartRecruiters | Anonymous PUBLIC postings only; employer-scoped discovery, offset pagination and selective section details. Internal postings are never requested. |
| Personio | Only employer-enabled public XML feeds. Company feeds may be empty or disabled; creation timestamps are not publication dates. Nonempty parsing is fixture-tested; the recorded live feed was empty. |
| Himalayas | Anonymous keyword search with page pagination, or cursor feed for company/location-only searches; daily freshness. Page limits leave coverage partial; location restrictions and explicit expiry are retained. Application links remain unchanged. |
| Remotive | Public remote feed, six-hour minimum normal refresh, source-attributed URLs; jobs are delayed by the source. Timestamps without timezone remain unknown. |
| GitHub (optional) | Application cells from two known public list formats supply leads, with no bundled employers. At most eight posting resolutions per batch; snippets and unresolved links are excluded with partial diagnostics. Employer pages require permitted public JSON-LD or scoped microdata, and robots permission. |
| All ATS/feed sources | Filters are local. Applicant counts and verification are unsupported/unknown and do not produce matches. Experience may use labeled high-confidence title evidence in normal mode; strict mode requires metadata. Location matching includes available secondary locations but is not geocoding or radius search. |
| LinkedIn | Company and entry/internship terms improve keyword retrieval; URL facets remain unverified hints. Required missing fields trigger bounded details; unknowns are excluded. Applicant lower bounds are not exact counts. |
| Indeed | Public HTML collection checks robots rules first. HTTP blocks stop requests and create a cooldown. Date buckets and other URL filters are hints; observed local evidence is required. |
| Glassdoor | Automated collection is restricted by default under the current provider terms; stderr supplies a browser-search link. Parsers remain fixture-tested for permitted use. No internal API or access workaround is used. |

Employer display names use source metadata where available. Where an ATS exposes
only its board label, `companyEvidence` is `board-identifier`; company filtering
does not treat that inferred label as a verified employer name. ATS salary objects
and HTML salary labels retain their source representation. Structured currencies/periods are kept only where valid;
raw labels are not converted into comparable annual amounts.

Unobserved server facets never qualify results. A normal-mode experience match
may use a clear Junior/Entry Level/Intern/Senior/Director title, labeled with
`filterEvidence: "title-supplemented"` and `inferredFilters`. This does not populate
missing employer seniority metadata. Staff/Principal titles reject entry searches
but alone do not prove a specific seniority tier. Conflicting title and employer
metadata are excluded rather than silently resolved. `--strict` requires metadata.
Calendar dates are evaluated conservatively when time/timezone are missing.

For example, LinkedIn `--search "Software Engineer" --company TikTok` now includes
TikTok as a retrieval hint and verifies the observed employer locally. `--experience entry`
adds an entry-level hint, rejects explicit Senior/Staff/Principal titles, and selectively
resolves unknown metadata. No fallback search is added. See the
[filter audit and measured regression results](docs/FILTER_ACCURACY.md).

Searches combine bounded candidate pools from every selected provider, consolidate
strong duplicate identities, rank globally, and then apply the total limit. With
`--sort relevant`, title phrases/token coverage, available description evidence,
small explicit equivalent aliases and trustworthy freshness determine rank.
`--sort recent` prioritizes known, nonfuture publication dates. Employer, title and
source-qualified ID break ties deterministically. Hard filters always apply.

Lexical matching normalizes Unicode, supports limited variants such as
engineer/engineering, and recognizes RN/registered nurse and CPA/certified public
accountant. Java and JavaScript remain distinct, as do C, C++ and C#.
Quote a phrase inside the argument to require contiguous normalized terms:
`jobs find --search '"registered nurse"' --website Ashby --sort relevant`.
Missing descriptions trigger bounded enrichment where an adapter supports it;
remaining incomplete evidence is reported as partial coverage, not proven irrelevance.

Only exact or strong compatible identities consolidate. Original source records and
provenance remain attached in JSON/CSV; title collisions never establish identity.
Lower-confidence similarities retain separate rows with `possibleDuplicateOf` hints.
Conflicting employers or requisition IDs remain separate.

## Progress, failures, and cancellation

Interactive terminals show a compact live table with one row for every selected
website, in selection order. Each row retains its own discovery, cache, collection,
filtering or completion activity. Bars show the visited/total board count when known
and animate during other work; finished and failed websites stay visible while
others continue. The final table remains above the results. Very short terminals
use static tables to avoid overwriting terminal history.
Animation is disabled in CI and when either output stream is non-interactive.
Diagnostics distinguish exact-cache hits/miss reasons, prior source coverage, stale
boards, current refresh/enrichment work and API request counts. A returned result cap
is reported separately from the number that passed filtering. All progress/diagnostics
use **stderr**; structured results use **stdout**:

```bash
jobs find --search "Accountant" --website Greenhouse Lever Ashby --format json > jobs.json
```

Provider failures do not discard other providers' results. Warnings identify stale
or partial data, with repetitive board errors summarized. If all selected providers
fail, exit status is 1. A recognized search with no accepted matches exits 0.
Ctrl+C cancels pending requests, finishes already-started atomic cache writes, and
exits 130. Completed cache records remain usable next time.

API calls use bounded concurrency, timeouts, exponential retry backoff with jitter,
and `Retry-After` handling. Restricted providers are backed off. HTML restrictions
are not retried. No CAPTCHA solving, login, cookie harvesting, proxy rotation,
authentication bypass, browser impersonation, or hidden API access is included.
Use site data only where authorized under the providers' terms.

## Other commands

| Command | Options and behavior |
| --- | --- |
| `job <id-or-url>` | Existing LinkedIn/Indeed/Glassdoor detail lookup; URL autodetection, one `--website`, `--delay`, `--save`, `--format`, `-o/--output`. Bare IDs default to LinkedIn. Direct ATS job lookup is not currently supported; use `find`. |
| `saved` | Local `--search`, `--company`, multi-value `--website`, positive `--limit`, `--format table|json|jsonl|csv`, `-o/--output`; all sources by default |
| `export` | Requires `-o/--output`; `--format json|jsonl|csv` (csv default), `--search`, `--company`, multi-value `--website`; no network |
| `stats` | Optional multi-value `--website`; JSON totals by website/company/employment/location; no network |
| `url` | Search filters above, without execution/output flags; prints supported HTML search URLs. API/feed sources are collected through `find`, so it explains that `find` handles discovery automatically. No network. |
| `doctor` | Runtime/store info; `--website <sites...>`, optional `--probe` and `--search` (probe default `chef`). ATS probes can discover boards but collect at most one board; partial coverage is reported. |
| `help [command]`, `[command] --help` | Show all command options |
| `--version`, `-V` | Print CLI version |

```bash
jobs saved --website Greenhouse Ashby --search "Nurse" --format json
jobs export --website Lever --format csv --output results/jobs.csv
jobs stats --website Greenhouse Lever Ashby
jobs doctor --probe --website Ashby
```

JSON and JSONL retain full records. CSV includes descriptions, salary, provenance,
original records for consolidated jobs, application/source URLs, attribution and
redistribution restrictions, board/source
identity, employer evidence, and `cacheStatus`/`cacheFetchedAt`. CSV quotes embedded
delimiters/newlines and neutralizes spreadsheet formula prefixes. Tables sanitize
terminal controls. Stale records are explicitly labeled in structured exports and
accompanied by partial/stale diagnostics.

Saved jobs are separate from disposable caches. The saved store defaults to
`~/.jobs-cli/jobs.json` (`%USERPROFILE%\.jobs-cli\jobs.json` on Windows). `JOBS_DB`
overrides it; legacy `LJOBS_DB` remains supported. Source-less legacy rows remain
LinkedIn, and older unprefixed IDs migrate when resaved. No existing saved data is
deleted by discovery or search filtering.

### Source attribution and use

Himalayas and Remotive results retain source links and attribution in all output
formats. Their public terms prohibit onward syndication to third-party job boards
or aggregators. Exports are for your own permitted use; preserve their attribution
and restrictions. Himalayas application URLs are preserved unchanged. The CLI does
not request or configure keys, including optional free keys offered by a source.
See [Himalayas terms and API](https://himalayas.app/api) and
[Remotive public API terms](https://github.com/remotive-com/remote-jobs-api).

## Troubleshooting

- **First search is slow:** public indexes and large company boards take time.
  Work is bounded and resumable; repeated searches reuse caches automatically. Identical
  commands reuse partial/stale results for up to three minutes; a later cache miss
  resumes collection.
  Changed criteria, expired results, new inventory membership or changed posting/parser
  revisions can require another collection. Rolling `--date` searches re-evaluate filters.
- **Partial coverage:** discovery, page/request budgets, board failures, or stale
  fallback limited the dataset. Results are not a complete count of platform jobs.
- **Archive outage:** known boards remain available; public-index fallbacks are
  attempted without keys. If every index is unavailable on a first run, the CLI
  reports that it could not discover boards; it cannot invent an inventory.
- **403/429/503 or timeout:** access may be restricted, rate-limited, or temporarily
  unavailable. The CLI backs off and uses valid cached data where possible.
- **No matches with `--date`:** Lever has no trustworthy posting date in the
  supported payload; Greenhouse date enrichment is bounded; unknown dates are excluded.
- **Unknown applicant/verification filters:** ATS APIs do not expose these fields.
  Remove those criteria if you want ATS matches.
- **Cache warning:** the CLI recovers corruption automatically. If the cache directory
  is unwritable, available fresh results are still returned with persistence warnings.
- **Saved-store error:** confirm `JOBS_DB`, directory permissions and JSON validity;
  requested saves fail explicitly rather than silently dropping data.

Indeed and Glassdoor use the existing `find` interface, with no extra setup. Successful
HTML searches are cached for ten minutes (three minutes for partial coverage), and
details and robots decisions for six hours. Repeated valid queries make no requests;
rolling dates are checked again. Blocks have a separate cooldown, never a false empty
result. Previously collected jobs may be shown for up to 24 hours after a failed refresh,
explicitly marked stale. Unknown applicant counts and verification flags cannot match
either true or false filters. See the [filter matrix and technical pipeline](docs/INDEED_GLASSDOOR_IMPLEMENTATION.md)
and [access policy](docs/PROVIDER_ACCESS.md). Use `jobs url --search "Chef" --website Indeed Glassdoor`
for browser-search links without making requests.

LinkedIn live parsing was previously verified. On 2026-10-29, Indeed returned 403;
Glassdoor was policy-restricted without requesting listings. No live success is claimed
for either source. The original three ATS APIs were tested on 2026-10-27. On 2026-10-28, live adapters
parsed SmartRecruiters (3 jobs), Himalayas (20, partial page budget), and Remotive
(11); Personio returned valid empty XML. Optional GitHub resolution produced two
complete postings from two leads, including a public employer page.
Website/API availability can change.

## Tests and CI

```bash
npm ci
npm run lint
npm test
npm run benchmark
npm run benchmark:cache
npm run benchmark:html
npm audit
```

Standard tests use fixtures and mocked responses, including real CLI subprocesses.
They do not require job websites, archive services, API keys, accounts, or seeded
company inventories. Lint checks all JavaScript syntax. GitHub Actions runs clean
installation, lint, tests, and offline CLI checks and the offline benchmark on Node 20/22/24 across Ubuntu and
Windows, with pinned actions and read-only repository permissions.

Optional, low-volume live smoke checks are separate from CI:

```bash
npm run test:live -- Greenhouse Lever Ashby
npm run test:live -- LinkedIn
```

`JOBS_SMOKE_SEARCH` changes the smoke keyword (default `accountant`). These checks
automatically discover boards and intentionally collect only a small sample. They
report partial coverage and can fail or return no matches when public services are
unavailable; they are not a complete harvest or proof of every filter.

Run `npm run benchmark` for reproducible offline retrieval, identity and cache
measurements. Its labels are synthetic/provisional and the fixture set is small.
On the initial fixture run, recall rose from 0.75 to 1.00 and NDCG@10 from 0.731 to
1.00; cold/warm mocked collection took about 67/7 ms with 3/0 requests. These are
regression measurements, not live coverage or production latency guarantees.

The cache regression benchmark uses 130 boards / 4,160 postings and separate Node
processes. One isolated comparison reduced the repeated command from 104 mocked
requests to zero and from 2,287 ms to 695 ms (including startup). Service delays are
virtual; disk, parsing and process costs are real. CI checks request/correctness
invariants rather than enforcing a machine-dependent subsecond timing threshold.
See [cache policies, cooldowns and measured comparison](docs/CACHE_PERFORMANCE.md).

Technical details: [pipeline improvements and limitations](docs/PIPELINE_IMPROVEMENTS.md), [architecture and cache schema](docs/ATS_ARCHITECTURE.md),
[audit and phase log](docs/ATS_PIPELINE_AUDIT.md),
[validation, performance, and remaining limits](docs/ATS_VALIDATION.md).

MIT licensed. Independent software, not affiliated with the job platforms or ATS vendors.
