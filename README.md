# Jobs Finder CLI (`jobs`)

Search **LinkedIn, Indeed, Glassdoor, Greenhouse, Lever, and Ashby** from one Node.js
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
jobs find --search "Accountant" --website Greenhouse Lever Ashby
jobs find --search "Nurse" --website LinkedIn Ashby --location "Boston"
jobs find --search "Electrician" --website LinkedIn Indeed Glassdoor Greenhouse Lever Ashby
jobs find --search "Teacher" --website Ashby --remote true --save --format json
```

Omitting `--website` selects **all six** providers. Names are case-insensitive;
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
archive indexes, with anonymous public-index fallbacks when an archive is unavailable.
Only selected ATS providers trigger discovery. A LinkedIn-only search never starts it.

First searches can take tens of seconds or minutes, depending on archive availability,
network delays and board size. Work runs in bounded batches. **A partial-coverage
warning means the CLI searched a subset, not every employer on that platform.**
Unvisited companies and partial pages are not treated as closed jobs. Future searches
continue automatic collection when cached results need refreshing.

Repeated searches reuse three independent cache layers:

| Cache | Normal refresh behavior |
| --- | --- |
| Company boards | Full discovery due after 30 days; recent discovery daily; validation around every 7 days |
| Board postings | Fresh for 20 minutes; only missing/stale or insufficient board snapshots are refreshed |
| Identical searches | Up to 10 minutes, bounded by underlying posting freshness and revision checks |

Short batches can span multiple searches; discovery completion means the configured
index pass finished, not that every employer worldwide was found. Failed discovery
never discards previously valid boards. Temporary failures can use labeled stale data
for up to seven days. Expired data is not presented as current. Partial-search cache
hits keep their warnings. Rolling `--date` searches re-evaluate time filters rather
than reuse potentially outdated exact results.

Caches live in the operating system's user cache directory, separate from saved
jobs and the repository. Corrupt cache records recover automatically. Normal use
requires no cache configuration. Advanced/test environments can override the cache
root with `JOBS_CACHE_DIR`; this is optional.

## All `find` arguments

| Argument | Default | Meaning |
| --- | --- | --- |
| `--website <sites...>` | all six | Select any supported providers |
| `--search <keywords>` | none | Provider query on HTML sites; local literal phrase over title/available description on ATS sites |
| `--company <name>` | none | Normalized equality, ignoring common legal suffixes and punctuation |
| `--location <place>` | none | Server query on LinkedIn/Indeed; local case-insensitive substring on Glassdoor/ATS locations |
| `--date <duration>` | none | Integer `Nh`, `Nd`, `Nw`; 1 hour through 365 days; `1d` is past 24 hours |
| `--remote <boolean>` | any | `true`: remote only; `false`: hybrid or on-site |
| `--workplace <type>` | any | `remote`, `hybrid`, `onsite` (`on-site` alias); conflicts with `--remote` |
| `--experience <level>` | any | `internship`, `entry`, `associate`, `senior`, `director`, `executive`; aliases `intern`, `entry-level`, `junior`, `mid`, `mid-senior` |
| `--employment <type>` | any | `full-time`, `part-time`, `contract`, `temporary`, `internship`, `volunteer`, `other`; aliases `fulltime`, `parttime`, `intern` |
| `--under <boolean>` | any | Fewer than 10 applicants (`true`) or at least 10 (`false`); unknown is excluded unless a supported true facet applies |
| `--verified <boolean>` | any | Explicit job verification; unknown does not mean false |
| `--limit <n>` | `25` | Combined result cap, integer 1–200; not a promised minimum |
| `--pages <n>` | `5` | Page cap per paginated board/provider, integer 1–20; does not set the company-discovery batch size |
| `--delay <ms>` | `1200` | Minimum request-start spacing, integer 750–30000; archive services can impose larger minimums |
| `--sort <order>` | `recent` | `recent` or `relevant`; local ranking within ATS results, URL hint on supported HTML sites |
| `--details` | off | Enrich candidates; request full Greenhouse descriptions |
| `--strict` | off | Require reliable evidence for requested filters; exclude unconfirmed server-facet matches |
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
| Greenhouse | Default list searches use titles without downloading all descriptions. Add `--details` for description matching. Date filtering fetches candidate details for the original publication date; modification time is kept separately. Detail work is bounded and incomplete coverage is reported. |
| Lever | Supports global/EU boards and public API pagination. Creation timestamps are retained separately; they are not treated as public posting dates. `--date` excludes jobs without a trustworthy publication date. |
| Ashby | Uses published dates and explicit workplace metadata. Hybrid jobs can also have `isRemote=true`; that boolean alone does not establish remote-only work. Unlisted postings are excluded. |
| All ATS providers | Filters are local. Applicant counts and verification are unsupported/unknown and do not produce matches. Seniority requires explicit metadata, never a title guess. Location matching includes available secondary locations but is not geocoding or radius search. |
| LinkedIn | Some URL facets are accepted without observable evidence in normal mode; `--strict` excludes them. Applicant lower bounds are not exact counts. |
| Indeed | Public access may be blocked. Date URL buckets are coarse; non-equivalent durations require local evidence. Several workplace/experience/employment filters lack reliable equivalents. |
| Glassdoor | Public access, detail routes and pagination can be restricted. No unverified server facets are claimed; unknown unsupported criteria exclude candidates. |

Employer display names use source metadata where available. Where an ATS exposes
only its board label, `companyEvidence` is `board-identifier`; strict company filtering
does not treat that inferred label as a verified employer name. ATS salary objects
and HTML salary labels retain their source representation.

HTML results relying on a supported but unobserved facet have
`linkedin-facet-unconfirmed` or `indeed-facet-unconfirmed` evidence and an
`unconfirmedFilters` list. Observed contradictions always exclude a posting.
Calendar dates are evaluated conservatively when time/timezone are missing.

Results interleave in selected provider order and respect the total limit. Sorting
within a provider does not create a global date sort. Source-qualified IDs preserve
distinct requisitions and separate websites. Specific identical posting URLs can
produce `possibleDuplicateOf` hints; those records are retained, not merged by title.

## Progress, failures, and cancellation

Interactive terminals show a small changing status line for discovery, cache use,
board collection, filtering, and completion. Known board totals appear in progress.
Animation is disabled in CI and when either output stream is non-interactive.
All progress/diagnostics use **stderr**; structured results use **stdout**:

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
| `url` | Search filters above, without execution/output flags; prints supported HTML search URLs. ATS providers have no global query URL, so it explains that `find` handles discovery automatically. No network. |
| `doctor` | Runtime/store info; `--website <sites...>`, optional `--probe` and `--search` (probe default `chef`). ATS probes can discover boards but collect at most one board; partial coverage is reported. |
| `help [command]`, `[command] --help` | Show all command options |
| `--version`, `-V` | Print CLI version |

```bash
jobs saved --website Greenhouse Ashby --search "Nurse" --format json
jobs export --website Lever --format csv --output results/jobs.csv
jobs stats --website Greenhouse Lever Ashby
jobs doctor --probe --website Ashby
```

JSON and JSONL retain full records. CSV includes descriptions, salary, board/source
identity, employer evidence, and `cacheStatus`/`cacheFetchedAt`. CSV quotes embedded
delimiters/newlines and neutralizes spreadsheet formula prefixes. Tables sanitize
terminal controls. Stale records are explicitly labeled in structured exports and
accompanied by partial/stale diagnostics.

Saved jobs are separate from disposable caches. The saved store defaults to
`~/.jobs-cli/jobs.json` (`%USERPROFILE%\.jobs-cli\jobs.json` on Windows). `JOBS_DB`
overrides it; legacy `LJOBS_DB` remains supported. Source-less legacy rows remain
LinkedIn, and older unprefixed IDs migrate when resaved. No existing saved data is
deleted by discovery or search filtering.

## Troubleshooting

- **First search is slow:** public indexes and large company boards take time.
  Work is bounded and resumable; repeated searches reuse caches automatically.
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

LinkedIn live parsing was previously verified; Indeed and Glassdoor returned 403
in the recorded checks. All three ATS APIs and bounded automatic discovery/collection
were tested successfully on 2026-10-27, with partial discovery coverage disclosed.
Website/API availability can change.

## Tests and CI

```bash
npm ci
npm run lint
npm test
npm audit
```

Standard tests use fixtures and mocked responses, including real CLI subprocesses.
They do not require job websites, archive services, API keys, accounts, or seeded
company inventories. Lint checks all JavaScript syntax. GitHub Actions runs clean
installation, lint, tests, and offline CLI checks on Node 20/22/24 across Ubuntu and
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

Technical details: [architecture and cache schema](docs/ATS_ARCHITECTURE.md),
[audit and phase log](docs/ATS_PIPELINE_AUDIT.md),
[validation, performance, and remaining limits](docs/ATS_VALIDATION.md).

MIT licensed. Independent software, not affiliated with the job platforms or ATS vendors.
