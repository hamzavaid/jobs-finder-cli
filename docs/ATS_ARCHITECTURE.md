# Automatic discovery and search architecture

This document describes the current pipeline. The original ATS audit and validation logs retain historical measurements; see [pipeline improvements](PIPELINE_IMPROVEMENTS.md) for the new milestone results.

## Flow and responsibilities

`jobs find` validates options, concurrently calls selected adapters, collects bounded candidate pools, consolidates strong identities, globally ranks, applies the result limit, and emits output. Original HTML providers retain their public search paths and server facets. Provider failures are isolated.

| Component | Responsibility |
| --- | --- |
| `providers.js` | Registry: three HTML sites, five employer ATS APIs/feeds, two global feeds, optional GitHub leads |
| `discovery.js`, `employer-candidate.js` | Public archive/index and job-list discovery, safe board extraction, validation, additive inventories, negative expiry and resumable cursors |
| `collection.js`, `board-scheduler.js` | Bounded refresh, query-aware scheduling, local filters, richer posting reuse and coverage accounting |
| `relevance.js`, `filter-engine.js`, `filters.js` | Token retrieval, explicit morphology/aliases, structured decisions, hard filters and stable ranking |
| `enrichment.js` | Common enrichJob contracts, shared in-flight work, cached-field preservation |
| `resolution.js`, `posting-parser.js` | Lead resolution, JSON-LD/scoped microdata, one-hop ATS routing, explicit resolution states |
| `api-http.js`, `public-http.js`, `concurrency.js` | Fixed API routes, generic public HTTPS/DNS checks, cancellation, throttling, request/body limits and retries |
| `schema.js`, `dedup.js` | Versioned normalized records, runtime validation, conservative identity consolidation and provenance |
| `cache.js` | Versioned JSON shards, atomic writes, manifests, process locks, recovery and pruning |
| `pipeline-metrics.js`, `progress.js` | Counters, stderr diagnostics and optional TTY rendering |

No runtime dependencies were added: Commander, Cheerio and robots-parser remain the three dependencies. No keys, accounts, daemons, database servers or company inventories are required.

## Discovery and scheduling

Selected employer ATS providers recognize Greenhouse's two board hosts, global/EU Lever, Ashby, SmartRecruiters career/job hosts, and Personio tenant subdomains (`.de`/`.com`). Candidate identity is provider + normalized tenant + region (plus Personio host suffix; .com/.de are not geographic region claims). URLs are decoded once, malformed/static identifiers rejected, and current API validation precedes inventory acceptance. HEAD is lightweight; unsupported/unreliable responses fall back to public GET. Only confirmed 404/410 failures become invalid; transient failures retain previously valid boards.

Wayback CDX pages use persisted resume keys and bounded pages. Common Crawl and anonymous existing urlscan results remain fallbacks. Known public GitHub job-list formats are independent inputs, with shared per-search downloads. They supply employer candidates, never a bundled employer registry. Candidates carry observed/discovery URLs, first/last-seen timestamps, validation status and retry times. Initial list coverage is biased toward technology internships/new graduates; full employer-board collection is occupation-neutral. Archive passes remain partial until their configured traversal actually finishes.

Inventory TTLs: full 30 days, recent one day, validation seven days. Up to eight candidate validations and two archive pages per hostname per invocation. No outage discards valid inventory. A cold list-derived batch with enough candidates defers archive traversal and reports partial coverage.

Board scheduling reserves about 25% of the 64-refresh budget for unexplored boards. Remaining ordering uses company identity, time-decayed query observations, prior success/activity and fetch age. Eight query observations per employer are retained. Age prevents permanent exclusion based on old relevance. Cooled-down boards follow eligible boards. Exact-search hits freeze the batch until the result TTL expires. Fresh snapshots are reused; no partial search marks unvisited jobs closed.

## Collection, enrichment and resolution

Two workers per provider and the shared scheduler across HTML/API/resolver transports bounds network work (four globally, two per API host, one for indexes). Default API/HTML timeout: 15 seconds; response cap: 16 MiB. Automatic HTML redirects are refused. Transient requests retry at most twice with exponential jitter and bounded Retry-After. Restrictions are never circumvented. Source host cooldowns and cancellation persist through scheduling.

Metadata precedes selective detail collection. Greenhouse uses bulk content when several unresolved records would cost more individual calls. Other supported adapters expose enrichJob, including no-extra-request behavior when public responses already contain their available fields. Default enrichment budgets: 40 individual and eight bulk attempts per provider search, constructor-configurable; two board workers also bound concurrent enrichment. The API transport owns configurable timeout/size limits. Prediction of response bytes is intentionally absent without reliable source size estimates.

Posting descriptions and publication dates survive lightweight refreshes. Cached full descriptions are reused across different queries. Per-snapshot enrichment metadata persists successes, failures and retry deadlines. Oversized/unsupported/structural failures wait 24 hours, transient failures five minutes. Query overlap and requested metadata take priority, with at most four no-overlap exploratory details. Unresolved keyword evidence is counted and disclosed; it cannot silently become proof of irrelevance. Strict filters still reject unknown required fields.

Himalayas uses anonymous keyword search when keywords exist; those snapshots have a query-qualified key. Company/location-only searches use the cursor feed. Page caps and repeated pages remain partial; known expiry removes cached jobs from eligibility and bounds exact-cache TTL. Remotive collects its unfiltered public feed at six-hour freshness. Both retain source-specific attribution/restrictions and original application links.

Optional GitHub collection reads application cells, skipping closed rows/promotions, and resolves at most eight leads per batch. Generic employer pages use robots checks and JSON-LD/scoped microdata; supported ATS links can take one additional hop. Every hop has URL validation, DNS address checks at connection time, no redirects, 15-second timeout and 4 MiB body cap. Private/reserved IPv4/IPv6 addresses and credentials are refused. Resolution states: complete, incomplete, blocked, unsupported, failed. No recursive crawler or browser automation is used.

## Normalized identity, retrieval and ranking

Job schema version 2 and parser version 4 retain legacy fields and add provider/board/requisition identities, employer evidence, description completeness, source date precision, canonical/application/discovery URLs, provenance, timestamps, content hash, resolution and cache states. Unknown optional values remain null. Source creation/modification times never substitute for publication. Invalid individual ATS rows are quarantined and make coverage partial rather than invalidating healthy sibling rows. Saved-store version 1 stays compatible through read-time normalization.

Retrieval uses NFKC, Unicode tokens, technical-token boundaries, limited explicit morphology and equivalent aliases. All query tokens must be evidenced; quoted phrases require contiguous normalized terms. Missing descriptions can trigger enrichment. Default signal weights: phrase/title/description/aliases/freshness = 40/25/20/10/5, normalized over available signals. No AI, fuzzy technology equivalence, stemming dependency or occupation-specific default is used.

Each provider contributes up to four times the requested limit, with a minimum pool of 100 and maximum 1000, subject to existing page/board limits. Global consolidation precedes global ranking and the final user limit. Recent order prioritizes trusted nonfuture publication dates; relevant order prioritizes lexical score. Dates, employer, title and qualified IDs break ties consistently.

Exact provider/region/tenant/ID matches and strong verified employer/requisition or compatible observed-employer posting URLs can consolidate. Original rows and provenance remain attached; employer/requisition conflicts cannot merge. Bounded hash buckets supply possible-duplicate hints for highly similar descriptions. A name alone never establishes verified employer identity.

## Cache schema and coordination

OS user cache directories are unchanged; `JOBS_CACHE_DIR` is an optional override. Saved jobs remain separate. Each shard is `{version:1, kind, key, updatedAt, expiresAt, data}` with UTC ISO timestamps and validated size/schema bounds.

| Kind | Data and policy |
| --- | --- |
| inventory | Additive board identities, validation/query observations, cursors, discovery completeness/cooldowns; no automatic deletion of valid employers |
| postings | Full query-independent ATS board snapshots; query-scoped Himalayas search snapshots; parser version, capabilities and semantic revision; ATS 20 min, Remotive 6 h, Himalayas 24 h, GitHub 6 h |
| search | Semantic options/provider selection, parser/policy version, results, historical coverage, authorized revision references and inventory membership fingerprint; complete 10 min / partial 3 min, bounded by source freshness/retention and job expiry; lookup precedes network discovery; rolling date filters always rerun |
| manifest | Revision/parser, source observation timestamps and snapshot file identity (size, mtime, ctime, inode); pending markers conservatively invalidate exact reuse during writes; unchanged semantic revisions avoid large snapshot rewrites |
| resolution | Successful complete postings 6 h; incomplete/blocked/unsupported/failed outcomes 15 min |
| maintenance | Last successful pruning time; daily lease under a process lock, skipped on exact hits |

Writes use exclusive temporary files, atomic rename and per-shard locks. Dead-owner locks and corrupt files recover automatically. A search-key lock rechecks exact results before discovery, and a separate refresh lock coordinates collection across CLI processes; after waiting, a process rechecks freshness. Bounded board-lock contention uses available stale cache with partial warnings and cannot issue enrichment requests. A same-query cold follower whose owner still holds the lock after two seconds reports busy instead of duplicating work. Manifest validation checks file identity without parsing posting records on normal exact hits. Legacy unstamped manifests conservatively validate/upgrade once. Pruning preserves immutable old snapshot files whose manifests prove recent source observations. Existing stale retention remains seven days, with explicit labels and known expiry honored. Cache revision hashes exclude observation timestamps and persisted retry metadata, and sort rows by ID so query planning does not change revisions; parser changes invalidate semantics. HTTP validators are bounded in-process (eight responses up to 2 MiB each), not persisted across runs.

## Verification and limits

`npm test` is offline, including actual CLI subprocesses and cross-process coordination. `npm run benchmark` uses synthetic provisional relevance/identity labels, not human-validated ground truth. CI covers Node 20/22/24 on Windows/Linux; optional `test:live` remains outside CI. Hosted CI status is distinct from local runs.

Coverage is bounded and reported. Neither archive discovery nor public lists enumerate all employers. Generic HTML without trustworthy posting metadata stays unsupported. Shared anonymous API allowances and public access restrictions can still block collection. No SQLite migration, universal HTML selector guessing, persistent HTTP response-body store, or learned ranking model was added without measured need.

Current regression evidence, exact invalidation rules and diagnostic timing definitions: [CACHE_PERFORMANCE.md](CACHE_PERFORMANCE.md).
