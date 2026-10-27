# Jobs CLI — LinkedIn + Indeed (`jobs`)

A JavaScript / Node.js command-line finder for public job postings on **LinkedIn and Indeed**, for **any occupation**: chefs, accountants, nurses, electricians, software engineers, and others. The main command is **`jobs find`**. It uses a shared filtering interface, source-labeled results, local storage, and JSON/CSV exports.

> **Access and permissions:** Both providers can change or restrict their public HTML. LinkedIn's and Indeed's terms limit automated collection. Only use this CLI with appropriate authorization and in compliance with applicable site terms and law. No login, cookie harvesting, anti-bot bypass, CAPTCHA solving, proxy rotation, or undocumented API keys are provided. A 403/429/security challenge stops access to that site; searching the other selected site may continue. Indeed's public results may be inaccessible without permission, and this project does not guarantee live results. See [LinkedIn's scraping guidance](https://www.linkedin.com/help/linkedin/answer/a1341387/prohibition-of-scraping-software) and [Indeed's terms](https://www.indeed.com/legal).

## Requirements and installation

- Node.js **20+** and npm; Node.js 22 is recommended.
- Network access and permission to access the selected sites.

Extract the ZIP, then run in the project folder:

```bash
npm install
npm link
jobs --help
```

`npm link` registers the **`jobs`** executable (not `ljobs`). If Windows PowerShell cannot find it, reopen the terminal. Running without a global command also works:

```bash
node bin/jobs.js --help
node bin/jobs.js find --search "chef" --location "Los Angeles"
```

## Quick start

### Both websites by default

```bash
jobs find --search "chef" --location "Los Angeles" --date "1d"
jobs find --search "tax accountant" --location "Chicago" --employment "full-time"
```

Omitting `--website` is equivalent to `--website "LinkedIn" "Indeed"`. Jobs are merged from both sites, interleaved so one site cannot take all result slots. Every result includes its originating site.

### One site or several

```bash
jobs find --search "electrician" --website "Indeed"
jobs find --search "nurse" --website "LinkedIn" --date "7d"
jobs find --search "software engineer" --website "LinkedIn" "Indeed"
jobs find --search "chef" --website "Indeed" "LinkedIn" --format json
```

Website names are **case-insensitive**. The following alternate syntaxes are also supported:

```bash
jobs find --search "accountant" --website linkedin indeed
jobs find --search "accountant" --website LinkedIn,Indeed
jobs find --search "accountant" --website LinkedIn --website Indeed
```

An unknown site causes a validation error; duplicates are removed. Supported values: `LinkedIn`, `Indeed`.

### Every requested filter

```bash
jobs find --website "LinkedIn" "Indeed" --search "software engineer" --date "1d" --company "Google" --remote "True" --experience "entry" --employment "internship" --under "True" --verified "True" --location "Los Angeles"
```

**Important:** Indeed does **not** expose equivalent public filters for applicant count or verified-job status. If either is requested, Indeed results lacking explicit supporting evidence are excluded rather than falsely marked as matches. LinkedIn applies its own facets, but some matches cannot be independently confirmed from public cards. Add `--strict` to exclude candidates relying on an unconfirmed facet. Narrow searches may return zero results.

### Save and export

```bash
jobs find --search "accountant" --date 7d --save --limit 20
jobs saved --format table
jobs export --format csv --output results/jobs.csv
jobs export --format json --output results/jobs.json
```

## Commands

| Command | Description | Network access? |
|---|---|---|
| `jobs find [options]` | Search LinkedIn, Indeed, or both | Yes |
| `jobs job <id-or-url> [options]` | Fetch an individual LinkedIn or Indeed posting | Yes |
| `jobs saved [options]` | Read locally saved jobs | No |
| `jobs export [options]` | Export saved jobs to CSV, JSON, or JSONL | No |
| `jobs stats` | Summarize saved jobs including counts per website | No |
| `jobs url [filters]` | Print provider search URL(s) without fetching | No |
| `jobs doctor [--probe]` | Show runtime and storage status; optional single-site probe | Only with `--probe` |
| `jobs --help` or `jobs <command> --help` | Show help | No |
| `jobs --version` | Print version | No |

### `jobs find` filters

| Argument | Values | Behavior |
|---|---|---|
| `--website <sites...>` | `LinkedIn`, `Indeed`, or both | **Default: both**; supports multiple space-separated, comma-separated, or repeated values. |
| `--search <keywords>` | Any title or keywords, e.g., `chef`, `accountant`, `software engineer` | Free-text search with **no occupation default**. |
| `--date <duration>` | `1h`, `1d`, `3d`, `7d`, `14d`, `30d`, or `Nh`, `Nd`, `Nw` | Last elapsed duration; `1d` means past 24 hours. Indeed offers coarser date buckets (1, 3, 7, 14 days), so some durations are approximate; strict mode may exclude uncertain dates. |
| `--company <name>` | Any company | Case-insensitive normalized company-name check after fetching. Also sent as an Indeed company filter (`rbc`). Results on either site may omit some legitimate matches. |
| `--remote <boolean>` | `true` / `false` | `true`: remote only. `false`: non-remote (hybrid or on-site). Omit for any workplace. LinkedIn has facets for both; Indeed's `false` is checked locally from visible fields when available. |
| `--workplace <type>` | `remote`, `hybrid`, `onsite` | More precise than `--remote`; mutually exclusive with it. Indeed lacks a reliable public on-site-only URL filter. |
| `--experience <level>` | `internship`, `entry`, `associate`, `senior`, `director`, `executive` (aliases: `intern`, `junior`, `mid`) | LinkedIn facet or limited Indeed `explvl` mapping (`entry`, `mid`, `senior`). Unsupported Indeed values require observable metadata. |
| `--employment <type>` | `full-time`, `part-time`, `contract`, `temporary`, `internship`, `volunteer`, `other` | Mapped to each site's available job-type filters. Some values are unavailable on Indeed and require observed metadata. |
| `--under <boolean>` | `true` / `false` | Under 10 applicants (`true`) or 10+ (`false`). LinkedIn has a `true` facet; Indeed does not have a corresponding reliable public facet or published count. Unknown does **not** mean false. |
| `--verified <boolean>` | `true` / `false` | LinkedIn has a `true` verification facet. Indeed does not expose an equivalent public filter. Unknown does **not** mean unverified. |
| `--location <place>` | City, region, country, etc. | E.g., `Los Angeles`, `Chicago`, `Remote`. |

At least one of `--search`, `--company`, or `--location` is required. Boolean inputs also accept `yes/no` or `1/0`, case-insensitively.

**Filter interpretation:** `--experience entry --employment internship` uses *two independent conditions*, not synonyms. These may be classified differently on each site. Requesting `--under true` and `--verified true` with both sites normally leaves only LinkedIn postings for which those facets can be applied. Unconfirmed LinkedIn facet matches are marked in the JSON results.

### `jobs find` execution options

| Argument | Default | Description |
|---|---|---|
| `--limit <n>` | `25` | Maximum total results, 1–200, **across all sites combined**. |
| `--pages <n>` | `5` | Maximum pages scanned **per site**, 1–20. Indeed pagination increments 10; LinkedIn uses returned card count. |
| `--delay <ms>` | `1200` | Minimum milliseconds between HTTP requests (750–30000). Shared across providers. |
| `--sort <order>` | `recent` | `recent` or `relevant`; each site may ignore the setting. |
| `--details` | Off | Request detail pages for enrichment when supported. More requests, higher access-failure risk. |
| `--strict` | Off | Exclude jobs whose requested filters cannot be independently verified from public data. |
| `--save` | Off | Store results locally, keyed by **`source:id`** to prevent collisions. |
| `--format <format>` | `table` | `table`, `json`, `jsonl`, or `csv`. |
| `-o, --output <path>` | stdout | Write output to a file. Parent directories are created. |

`--limit` is a cap, **not a minimum**. If one provider fails, `find` prints a warning on stderr and keeps results from the other provider. If both providers fail, the command exits with an error. Output written to stdout in JSON/CSV mode is not mixed with progress messages. Results are interleaved by provider in their requested order, **not globally sorted** by posting time. A listing duplicated across LinkedIn and Indeed remains two source-attributed records; within-provider job IDs are deduplicated.

### `jobs job`

```bash
jobs job 1234567890 --website LinkedIn --format json
jobs job "https://www.linkedin.com/jobs/view/1234567890/" --save
jobs job abcdef1234567890 --website Indeed --format json
jobs job "https://www.indeed.com/viewjob?jk=abcdef1234567890" --format json
```

URLs automatically select the provider; with a bare ID, use `--website Indeed` for Indeed keys. `job` supports `--website`, `--format`, `--output`, `--save`, and `--delay`. IDs above are illustrative.

### `jobs saved` and `jobs export`

```bash
jobs saved --company "Google" --format json --limit 10
jobs saved --search "sous chef"
jobs export -o results/all.csv
jobs export --format jsonl --output results/all.jsonl --search "accountant"
```

Both accept `--search` and `--company` (local case-insensitive matching). `saved` additionally accepts `--limit`, `--format`, `--output`. `export` requires `--output` and accepts `--format json|jsonl|csv` (CSV default). These commands **do not request jobs online**.

### `jobs stats`

```bash
jobs stats
```

Returns JSON with `total`, `byWebsite`, `byCompany`, `byEmployment`, and `byLocation` counts of saved entries.

### `jobs url`

```bash
jobs url --search "electrician" --location "New York"              # prints both URLs
jobs url --website Indeed --search "chef" --date 1d
jobs url --website LinkedIn Indeed --search "nurse" --remote true
```

Uses the same filter arguments as `find`, including multi-value `--website`, but **does not perform an HTTP request**. Provider-specific unsupported conditions (particularly Indeed's `--under` and `--verified`) are *not* included in URLs, even if supplied.

### `jobs doctor`

```bash
jobs doctor
jobs doctor --probe --website Indeed --search "chef"
jobs doctor --probe --website LinkedIn --search "accountant"
```

Reports Node version, storage path, saved count, and optionally the status of **one** public search request for the chosen website. `doctor --probe` does **not** confirm job availability or parsing.

## Normalized results and evidence

Example (illustrative, not a live job):

```json
{
  "source": "Indeed",
  "id": "abcdef1234567890",
  "title": "Sous Chef",
  "company": "Example Kitchens",
  "location": "Los Angeles, CA",
  "url": "https://www.indeed.com/viewjob?jk=abcdef1234567890",
  "postedAt": null,
  "datePrecision": null,
  "postedText": "2 hours ago",
  "workplace": null,
  "employmentType": "Full-time",
  "seniorityLevel": null,
  "applicantCount": null,
  "underTenApplicants": null,
  "verified": null,
  "filterEvidence": "indeed-facet-unconfirmed",
  "unconfirmedFilters": ["date"],
  "detailsFetched": false
}
```

Dates available only as calendar dates or relative text may not confirm precise hours. Unsupported filter dimensions return `null` (unknown) rather than fabricated `false` or `0`.

- `observed-or-unfiltered`: no selected filter relies on an unobserved server facet.
- `linkedin-facet-unconfirmed`: a LinkedIn facet may have been used but could not be confirmed from visible public metadata.
- `indeed-facet-unconfirmed`: an Indeed facet may have been used but could not be confirmed from visible public metadata.
- `unconfirmedFilters`: which dimensions require review.

`--strict` excludes uncertain matches. Neither site's public search index should be treated as complete or authoritative.

## Storage

Default local store:

- Windows: `%USERPROFILE%\.jobs-cli\jobs.json`
- macOS/Linux: `~/.jobs-cli/jobs.json`

Override with `JOBS_DB`. The older `LJOBS_DB` variable is also supported for compatibility:

```powershell
$env:JOBS_DB = "C:\jobs\saved.json"
jobs find --search "teacher" --save
```

```bash
JOBS_DB=./data/jobs.json jobs find --search "teacher" --save
```

The original `ljobs` store (`~/.ljobs/jobs.json`) is **not automatically moved**. To use existing data, set `JOBS_DB` to the old file path. Existing unprefixed LinkedIn IDs are migrated individually when you resave the corresponding job. No profile, cookies, or login credentials are required.

## Architecture

```text
bin/jobs.js               Commander CLI entrypoint
src/cli.js                Commands, validation, output orchestration
src/filters.js            Cross-site filter normalization / LinkedIn URL mapping
src/indeed.js             Indeed URL mapping, DOM and embedded JSON parsing, search
src/parser.js             LinkedIn guest card and detail parsing
src/search.js             LinkedIn search and multi-provider orchestration
src/http.js               Shared rate-limited HTTP client, no access-control bypass
src/store.js              Local JSON store (source-qualified keys)
src/output.js             Table, CSV, JSON, JSONL formatting
test/                     Offline unit tests and HTML fixtures
```

The Indeed parser reads publicly delivered HTML job cards and, if available, JSON already embedded in the HTML. It never executes JavaScript from a scraped page. The Indeed implementation is **best-effort**, since site HTML, allowed access, and pagination can change without notice.

## Testing and troubleshooting

```bash
npm test
npm run lint
jobs doctor
jobs doctor --probe --website LinkedIn
```

- **`jobs: command not found`**: run `npm link` from the project folder or use `node bin/jobs.js`.
- **HTTP 403/429/999 or challenge**: access is restricted; the CLI **stops** that provider rather than bypassing it. Consider the provider's official website or permitted data channels.
- **No results**: check `jobs url ...` in a regular browser, widen `--date`, reduce company-specific restrictions, and remove `--strict` to see which source facets are uncertain.
- **Indeed results missing with `--under` or `--verified`**: expected: applicant counts and verified-job status are not reliably available through the public Indeed search surface.
- **HTML changed**: adapt selectors/embedded JSON parsing and add a recorded test fixture; do not suppress access challenges.

Automated live fetches have not been verified by the bundled offline fixtures. Live search depends on network permissions and current website HTML; no working result count is guaranteed.

## License

MIT. Independent software, not affiliated with, endorsed by, or officially supported by LinkedIn or Indeed.
