# Jobs Finder CLI (`jobs`)

An occupation-neutral Node.js CLI for public **LinkedIn, Indeed, and Glassdoor**
job pages. Search for chefs, accountants, nurses, electricians, engineers, or any
other occupation. The default is all three providers. Results retain source labels,
can be saved locally, and export as JSON, JSONL, or CSV.

**No external API keys, paid APIs, scraping services, proxies, subscriptions, or
user accounts are required by this software.** Runtime dependencies are free,
open-source Cheerio, Commander, and robots-parser. It reads public HTML using
Node's fetch; it does not execute website scripts, log in, collect cookies, solve
CAPTCHAs, impersonate a browser, or bypass access restrictions.

Public access is not guaranteed. A site may require authentication or block automated
requests; the CLI reports that restriction and continues other selected providers.
Use only with appropriate authorization under the providers' terms:
[LinkedIn](https://www.linkedin.com/help/linkedin/answer/a1341387/prohibition-of-scraping-software),
[Indeed](https://www.indeed.com/legal), [Glassdoor](https://www.glassdoor.com/about/terms/).
Glassdoor's provider also checks its current robots.txt before requesting job pages.

## Installation

Requires Node.js **20+** and npm. CI targets Node 20, 22 and 24; choose an actively
supported Node release for regular use.

```bash
git clone https://github.com/hamzavaid/jobs-finder-cli.git
cd jobs-finder-cli
npm ci
npm link
jobs --help
```

You can also extract the project and run `npm ci` in its folder. `npm link` is
optional; without it, use `node bin/jobs.js` instead of `jobs`, or:

```bash
npm start -- find --search "chef"
```

On Windows, reopen your terminal if `jobs` is missing from PATH. If PowerShell
blocks `npm.ps1` or `jobs.ps1`, use `npm.cmd` and `jobs.cmd`, or `node bin/jobs.js`.

## Quick start

```bash
jobs find --search "chef"
jobs find --website "Glassdoor" --search "accountant"
jobs find --website "LinkedIn" "Glassdoor" --search "software engineer"
jobs find --website "LinkedIn" "Indeed" "Glassdoor" --search "mechanical engineer"
jobs find --search "nurse" --location "Boston" --date "7d" --save
jobs saved --website Glassdoor --format json
jobs export --format csv --output results/jobs.csv
```

Names are case-insensitive. Multiple values, comma-separated names, and repeated
flags work; duplicates are removed, preserving the first supplied order:

```bash
jobs find --search "electrician" --website linkedin glassdoor
jobs find --search "electrician" --website LinkedIn,Indeed,Glassdoor
jobs find --search "electrician" --website Indeed --website Glassdoor Indeed
```

Invalid or empty provider names fail. At least one of `--search`, `--company`, or
`--location` is required for `find` and `url`. There is no default occupation.

## Commands

| Command | Purpose | Network |
| --- | --- | --- |
| `find [options]` | Search selected providers; default all three | Yes |
| `job <id-or-url> [options]` | Retrieve one posting | Yes |
| `saved [options]` | Retrieve locally saved postings | No |
| `export [options]` | Export locally saved postings | No |
| `stats [options]` | Count saved postings by source/company/type/location | No |
| `url [filters]` | Print each selected provider's search URL | No |
| `doctor [options]` | Report runtime/store; optionally probe providers | Only with `--probe` |
| `help [command]`, `[command] --help` | Show usage | No |
| `--version`, `-V` | Print version | No |

### Search filters (`find` and `url`)

| Argument | Accepted values and behavior |
| --- | --- |
| `--website <sites...>` | `LinkedIn`, `Indeed`, `Glassdoor`; default all three |
| `--search <keywords>` | Free-form keywords sent to provider search |
| `--date <duration>` | Integer `Nh`, `Nd`, `Nw`; 1 hour through 365 days; `1d` means past 24 hours |
| `--company <name>` | Local normalized equality; ignores common legal suffixes and punctuation; also a query hint |
| `--remote <boolean>` | `true`: remote; `false`: hybrid or on-site; omit for any |
| `--workplace <type>` | `remote`, `hybrid`, `onsite` (`on-site` alias); conflicts with `--remote` |
| `--experience <level>` | `internship`, `entry`, `associate`, `senior`, `director`, `executive`; aliases `intern`, `entry-level`, `junior`, `mid`, `mid-senior` |
| `--employment <type>` | `full-time`, `part-time`, `contract`, `temporary`, `internship`, `volunteer`, `other`; aliases `fulltime`, `parttime`, `intern` |
| `--under <boolean>` | `true`: fewer than 10 applicants; `false`: at least 10; unknown does not mean false |
| `--verified <boolean>` | Explicit job verification; employer verification alone is insufficient |
| `--location <place>` | Server query on LinkedIn/Indeed; local case-insensitive location substring on Glassdoor |

Boolean values accept `true/false`, `yes/no`, or `1/0`, case-insensitively. They
require a value. Experience and employment are independent filters; entry-level
does not imply internship. Unknown attributes are never fabricated.

### `find` execution and output options

| Argument | Default | Behavior |
| --- | --- | --- |
| `--limit <n>` | `25` | Total accepted results across all providers, integer 1–200 |
| `--pages <n>` | `5` | Maximum pages per provider, integer 1–20; public access may stop earlier |
| `--delay <ms>` | `1200` | Minimum request-start spacing, integer 750–30000; shared by all providers |
| `--sort <order>` | `recent` | `recent` or `relevant`; provider hint, not a global sort |
| `--details` | off | Request posting details for candidate enrichment |
| `--strict` | off | Fetch details and exclude unconfirmed server-facet matches |
| `--save` | off | Upsert accepted results into the local store |
| `--format <type>` | `table` | `table`, `json`, `jsonl`, `csv` |
| `-o, --output <file>` | stdout | Write output; create missing parent folders |

```bash
jobs find --search "chef" --website LinkedIn --remote false --employment full-time --details
jobs find --search "accountant" --company "Example" --experience entry --date 7d --strict
jobs find --search "teacher" --website LinkedIn Indeed --format json -o results/teachers.json
```

Each provider deduplicates by posting ID and stops repeated pages. Results interleave
in requested provider order and respect the combined limit. Different IDs remain
distinct even if title/company match; a posting on multiple sites keeps one record
per site. Results are **not globally sorted** by date.

Errors and progress go to stderr; JSON/CSV/JSONL stdout remains machine-readable.
One provider failure does not stop the others. A later-page/detail failure retains
already accepted results with a partial-results warning. If every selected provider
fails before accepting results, the command exits 1. Successful searches, including
explicit no-results pages or searches whose candidates all fail filters, exit 0.
Validation/storage/network failures exit 1.

### Provider filter limitations

| Criterion | LinkedIn | Indeed | Glassdoor |
| --- | --- | --- | --- |
| Keywords | Public guest query | Public search query | Public keyword search route |
| Location | Server query | Server query | Local substring; no geocoding or radius equivalence |
| Company | Local normalized equality | Local equality plus query hint | Local equality plus query hint |
| Date | Seconds-based URL facet; prefer observed date | 1/3/7/14-day URL buckets | Observed dates only |
| Workplace | URL facets plus observed metadata | Remote/hybrid URL mappings; non-remote requires observation | Explicit workplace or location text only |
| Experience | URL facet plus observed criteria | Limited entry/mid/senior URL mappings | Explicit metadata only; never inferred from title |
| Employment | URL facet plus observed criteria | Limited job-type URL mappings | Explicit metadata only |
| Applicant count / verification | Observed component or unconfirmed `true` facet | Unknown excluded | Unknown excluded |
| Sort | URL hint | URL hint | Site default; requested sort not guaranteed |

A supported server facet may be accepted without independent evidence in normal
mode, labeled `linkedin-facet-unconfirmed` or `indeed-facet-unconfirmed` and listed
in `unconfirmedFilters`. `--strict` excludes those matches. A contradictory observed
attribute always excludes a job. Unsupported criteria with unknown values exclude
it in both modes. Glassdoor claims no unverified server facets.

Indeed's bucket counts as a date facet only if it equals the requested duration.
For example, `2d` maps to a 3-day bucket but still requires a locally verifiable date.
Calendar dates have no exact posting time or timezone; filtering uses a conservative
timezone envelope and accepts them as confirmed only when that entire interval is
inside the requested window. Old/future contradictory dates are excluded.

Glassdoor exposes salary text where present, retaining labels such as “Glassdoor
est.” Structured salary values remain objects. It cannot reliably expose applicant
counts or job verification, so those fields remain `null`. Public next links are
followed only if robots.txt permits them. Current `_IP` pagination restrictions,
client-only “Show more jobs”, login pages, challenges, or unknown HTML produce
explicit errors/warnings. No hidden API is used to obtain additional pages.
See [research and live-access evidence](docs/GLASSDOOR_RESEARCH.md).

### `job`

```bash
jobs job 1234567890 --website LinkedIn --format json
jobs job "https://www.indeed.com/viewjob?jk=abcdef1234567890" --save
jobs job "https://www.glassdoor.com/job-listing/example.htm?jl=100000000001" --format json
```

IDs above are illustrative. Posting URLs select the provider automatically; an
explicit conflicting `--website` is an error. Bare IDs default to LinkedIn; use
`--website Indeed` or `--website Glassdoor` for other providers. Glassdoor bare-ID
detail routes may be disallowed by robots.txt; prefer an actual public posting URL.
Even a public posting URL may be blocked.

Options: `--website <site>` (one), `--delay <ms>` (1200; 750–30000), `--save`,
`--format table|json|jsonl|csv` (table), `-o/--output <file>` (stdout).

### Local commands

```bash
jobs saved --website Glassdoor Indeed --search "nurse" --limit 50 --format json
jobs export --website Glassdoor --company "Example" --format jsonl -o results/jobs.jsonl
jobs stats --website LinkedIn Glassdoor
```

`saved` accepts `--website <sites...>`, `--search <text>`, `--company <name>`,
`--limit <positive integer>`, `--format table|json|jsonl|csv` (table), and
`-o/--output <file>`. Without a limit it returns all matching saved rows.

`export` requires `-o/--output <file>` and accepts `--format json|jsonl|csv` (csv),
`--search`, `--company`, and `--website`. Search is a local case-insensitive substring
over title/company/description/location. No new jobs are fetched.

`stats` accepts `--website <sites...>` and returns JSON with `total`, `byWebsite`,
`byCompany`, `byEmployment`, and `byLocation`. Local commands include all sources
unless `--website` is supplied.

### `url` and `doctor`

```bash
jobs url --search "electrician" --website LinkedIn Indeed Glassdoor
jobs doctor
jobs doctor --probe --website Glassdoor --search "accountant"
```

`url` accepts the search-filter table above and prints URLs in selected order. Local
filters do not necessarily appear in provider URLs. It accepts no find execution
options and makes no network requests.

`doctor` accepts `--probe`, `--search <keywords>` (default `chef`, for probing), and
`--website <sites...>` (all three). It reports Node version, store path/count, and
selected websites. Probing makes at most one search request per source, plus the
Glassdoor robots request; it disables retries and validates recognized cards or an
explicit no-results page. Errors are reported independently and exit 1. A successful
probe does not establish that every filter, detail page, or subsequent page works.

## Data, exports, and persistence

Normalized records include source, ID, title, company, location, URL, description,
workplace, employment type, seniority, salary, posting date/precision/text, applicant
count, under-ten status, verification, fetch timestamp and filter evidence. Missing
values are `null`. Lower-bound applicant text is not an exact count. JSON and JSONL
retain full records; CSV includes core fields, salary, description and evidence,
quotes embedded delimiters/newlines, and neutralizes spreadsheet formula prefixes.
Tables sanitize terminal control characters.

Default storage is `%USERPROFILE%\.jobs-cli\jobs.json` on Windows and
`~/.jobs-cli/jobs.json` on macOS/Linux. Override with `JOBS_DB`; the older `LJOBS_DB`
variable remains supported (`JOBS_DB` takes precedence):

```powershell
$env:JOBS_DB = ".\data\jobs.json"
jobs find --search "teacher" --save
```

```bash
JOBS_DB=./data/jobs.json jobs find --search "teacher" --save
```

Keys are `source:id`. Legacy source-less rows are LinkedIn; unprefixed keys migrate
when resaved. The older `~/.ljobs/jobs.json` is not moved automatically; point
`JOBS_DB` there if needed. Updates use same-directory temporary files and atomic
rename, serialize writers inside a process, and use an exclusive lock across
processes. Competing processes receive a descriptive lock error. Corrupt stores are
reported without overwriting them. A crashed writer can leave a `.lock`; remove it
only after confirming no process is writing. Keep backups of important saved data.

## Testing and CI

```bash
npm ci
npm run lint
npm test
npm audit
```

The standard tests are deterministic and use fixtures/mocked fetch. They exercise
real CLI subprocesses, all providers, filters/unknowns, pagination/deduplication,
failure isolation, retries/timeouts/rate spacing, persistence/concurrent writes,
exports and regressions. Glassdoor fixtures are synthetic contracts; they are not
evidence of successful live parsing. Lint performs syntax checks recursively over
all JavaScript source, tests and scripts.

GitHub Actions runs on pushes and pull requests across Node 20/22/24 on Ubuntu and
Windows. It runs `npm ci`, lint, tests and offline CLI checks. Actions are pinned to
immutable revisions and have read-only repository permissions. No live scraping
runs in CI; dependency installation still requires the npm registry.

Optional live checks, using one page per selected provider, no details and no retries:

```bash
npm run test:live
npm run test:live -- LinkedIn Glassdoor
```

Set `JOBS_SMOKE_SEARCH` to change the default `accountant` keyword. The script emits
one JSON status per provider and exits 1 for blocked, invalid or inconclusive empty
results. Run only where authorized. On **2026-10-27**, the live check parsed three
LinkedIn cards; Indeed and Glassdoor returned HTTP 403. Their live extraction remains
unverified. Offline tests do not establish future website availability.

## Troubleshooting

- **403/429/999, login or CAPTCHA:** the provider stops. Choose another provider or
  use the site's official interface; no bypass is included.
- **Unrecognized HTML:** markup may have changed or require client rendering. This
  is a provider error, not an invented successful empty result.
- **No accepted results:** relax filters, inspect JSON evidence, or increase the page
  cap. `--limit` is a maximum, not a promised minimum.
- **Glassdoor location mismatches:** local substring matching does not expand city
  aliases, regions, distance or country names. Missing location excludes a match.
- **Missing date/type/applicant metadata:** `--details` may help on accessible pages;
  it cannot establish attributes the provider does not expose.
- **Slow searches:** requests share one lane (concurrency 1), minimum spacing and a
  15-second per-attempt timeout covering headers and body. Network/timeouts and
  HTTP 500/502/503/504 get at most two retries with bounded backoff. Restrictions,
  challenges and ordinary 4xx errors are never retried.
- **Store error:** confirm `JOBS_DB`, directory permissions and JSON validity. A
  blocked writer or failed save exits with a descriptive error.

## Architecture and engineering notes

`src/providers.js` registers provider descriptors. `provider-search.js` owns the
shared pagination/filtering loop; `linkedin.js`, `indeed.js`, `glassdoor.js` and
`parser.js` own site behavior. `http.js` provides the shared request queue,
`filters.js` validates options and evidence, `schema.js` handles nullable fields and
JSON-LD, and `store.js`/`output.js` handle persistence/exports. The CLI orchestrates
these modules. No browser automation dependency is required.

See the [quality audit](docs/QUALITY_AUDIT.md) for findings and fixes and the
[engineering summary](docs/ENGINEERING_SUMMARY.md) for validation and remaining work.

MIT licensed. Independent software; not affiliated with LinkedIn, Indeed or Glassdoor.
