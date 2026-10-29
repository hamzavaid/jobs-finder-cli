# Filter accuracy audit and regression evidence

Reviewed 2026-10-29. Baseline `b0ef053`; Node.js/ES modules, existing adapters,
FilterEngine, CacheManager, pagination, ranking, output and CLI retained. No new
dependencies, setup commands, credentials or fallback query fan-out were added.
Baseline lint passed and all 184 tests passed; those tests did not detect the
reported retrieval/evidence errors. Six new reproductions failed before fixes.

## Confirmed causes and changes

| Argument / behavior | Finding | Resulting policy / fix |
| --- | --- | --- |
| search | HTML cards were accepted without checking returned text; source parameters could yield unrelated occupations | Existing token/alias/quoted-phrase logic verifies HTML title, description, observed employer and location; ATS/feed scope remains title/description. Incomplete evidence is excluded with partial coverage. No arbitrary Boolean query grammar was added. |
| company | LinkedIn ignored company in keywords when search was provided; downstream equality then rejected the unrelated candidate pool | Append the company once as a retrieval hint; require actual normalized employer equality. Common legal suffixes/punctuation are normalized. No parent/subsidiary or agency relationship is guessed. Board identifiers alone never establish employer identity. |
| experience | LinkedIn's supported-facet list let missing seniority pass; explicit senior titles were ignored | All unknown facets are excluded. Metadata is primary; title contradictions are an exclusion guard. Clear title evidence may supplement missing metadata only in normal mode and is labeled. Unknown candidates can receive bounded details. |
| employment | Missing job type could qualify solely through f_JT | Require normalized observed types, including multiple explicitly listed types; full-time alone cannot establish internship. Experience and employment are independent. |
| remote / workplace | LinkedIn cards discarded workplace indications; unknown values could pass a server facet | Read explicit location annotations, retain typed detail evidence, and verify remote/hybrid/onsite locally. false means hybrid or onsite, never unknown. A mixed remote-or-onsite phrase without hybrid evidence is unknown. |
| date | Missing/coarse dates could pass solely through f_TPR; invalid calendar days could roll into another date | Trust only validated publication timestamps; exact 1d means 24 hours. Calendar dates retain UTC-14..UTC+14 uncertainty and must fit the complete requested window. Fetch/update/relative-age text does not become a posting timestamp. |
| location | LinkedIn did not verify its server query; loose substring matching could match LA inside Malaysia | Shared contiguous normalized word matching over primary/secondary locations; unknowns excluded. No geocoding, radius or country-alias guarantee. |
| under | Unknown true values qualified through f_EA | Both booleans require observed count/threshold evidence. Exact counts take precedence; contradictory threshold/count records are rejected. Lower bounds do not become invented exact counts. |
| verified | Missing job verification could qualify through f_VJ | Only explicit job verification evidence qualifies. Employer verification is separate; unknown is neither true nor false. |
| sort | Existing global ranking already followed collection/deduplication | Retained recent/relevant ordering and stable tie-breaking after constraints. Unknown dates remain last. |
| limit | Existing orchestrator used bounded candidate pools and a final combined cap | Retained accepted-result limits; missing evidence and rejected cards never fill them. A limit is not a promised minimum. |
| pages | Existing URL/card visitation was bounded; reaching a LinkedIn page budget did not emit a coverage warning | Preserve repeated-page safeguards; explicitly warn when page/result/detail budgets leave coverage incomplete. No extra fallback pages or queries. |
| strict | Previously differentiated accepted unverifiable facets from excluded ones | Unknown required attributes are excluded in both modes. Strict additionally requires experience metadata instead of title-only supplementation; selective details can establish it. |
| details | LinkedIn detail work was unbounded and did not resolve most requested missing fields automatically | At most 25 actual detail requests per HTML provider. Prioritize keyword matches; explore at most two zero-overlap cards unless details explicitly requested. Persist successful details by source ID/version and reuse them across queries. |
| save / format / output | Existing store and serializers ran after global filtering | Retained. Only accepted results are saved/exported. JSON/JSONL retain inferredFilters, CSV appends that field without reordering old columns, and table output explains title-based evidence. Diagnostics remain on stderr. |

## LinkedIn query plan and evidence

The adapter still builds one guest-search URL per page with URLSearchParams.
Company is appended only when its words are not already present. An entry request
adds entry-level when the query does not already contain an equivalent junior/new
graduate hint; internship similarly adds internship only when absent. Other flags
are not appended as text. Existing mappings are retained, not declared live-verified:

| Parameter | Encoding | Evidence status |
| --- | --- | --- |
| keywords | Original search + selective company/entry/internship hints | Fixture-tested construction; server retrieval behavior unverified live |
| f_E | Internship 1, entry 2, associate 3, mid/senior 4, director 5, executive 6 | Legacy hint only; never proves local seniority |
| f_JT | F/P/C/T/I/V/O | Legacy hint only; observed employment required |
| f_WT | onsite 1, remote 2, hybrid 3; remote=false uses 1,3 | Legacy hint only; observed workplace required |
| f_TPR | r + duration in seconds | Legacy hint only; source date precision required |
| f_EA / f_VJ | true only when requested true | Legacy hints only; applicant/verification evidence required |
| location | Encoded user place | Hint plus independent observed location check |
| sortBy | DD recent, R relevant | Hint plus existing global local ranking |
| start | Existing bounded offset progression | Repeated cards/URLs stop collection |

Indeed retains q/l/fromage/jt/explvl/workplace hints and observed local constraints;
Glassdoor retains its permitted-route design with local geographic scope warning.
All ATS/feed hard filters use the shared evaluator over their normalized fields.
Greenhouse original posting dates, Lever creation dates, Ashby hybrid metadata and
source-specific unknowns keep their existing meanings. Normalized fields are not
filled with guesses merely to satisfy a filter.

Title evidence: Junior/Entry Level -> entry; Intern/Internship -> internship;
Senior -> mid/senior; Director -> director where unambiguous. Staff/Principal are
non-entry guards, not positive proof of a particular senior tier. Engineer II and
generic Engineer remain unknown without metadata. Any recognized conflict between
title and employer metadata rejects the requested experience constraint; neither
source silently overwrites the other. Mixed/unrecognized nonempty seniority metadata
does not get overridden by a convenient title. Title inference leaves seniorityLevel
unchanged and records inferredFilters plus title-supplemented filterEvidence.

## Before / after reproductions (synthetic, not live)

Loaded the baseline query builder and shared search implementation from Git at
`b0ef053` and compared them with the changed pipeline using identical synthetic
HTML cards and fixture transports. The provider parsers were held constant.

| Case | Baseline | Changed pipeline |
| --- | --- | --- |
| experience entry; seven cards including Senior, Staff, Principal, Senior II, Junior, Engineer II, Engineer | 7 accepted, 0 rejected, 1 request; all four explicit non-entry roles passed | 3 accepted, 4 rejected, 3 requests; Junior uses labeled title evidence, two ambiguous roles receive observed entry metadata through details |
| company TikTok plus Software Engineer | keywords omitted TikTok; 0 accepted, 1 request | keywords include TikTok; 1 actual TikTok posting accepted, 1 request; unrelated employers are excluded |

This establishes local regression behavior and the justification for selective
detail requests; it does not measure current LinkedIn search availability or
guarantee a live vacancy count. Explicit negative titles are rejected before any
detail request. A separate 40-unrelated-card fixture followed by a plausible job
finds the relevant entry posting with 3 details (1 plausible + 2 exploration),
instead of exhausting the budget on unrelated cards.

## Cache, performance and verification

FILTER_VERSION=2 is included in HTML query keys. HTML detail keys include that
version too. ATS exact query keys use retrievalVersion=6 plus FILTER_VERSION; valid
board snapshots are preserved and re-filtered rather than invalidated wholesale.
LinkedIn now reuses the existing atomic HTML query/detail cache implementation:
10-minute complete / 3-minute partial query TTL, 6-hour details, bounded stale
fallback, locking and cancellation. A valid repeat makes zero network requests.

Measured on Windows/Node 25.2.1 with two separate CLI processes and synthetic fetch:
Software Engineer + company TikTok + experience entry, three cards including one
Senior role. Cold: **1,371 ms**, **2 mock requests** (search + one missing-level
detail), **2 accepted**. Immediate repeat: **810 ms**, **0 requests**, same two
accepted titles (Junior Software Engineer and Software Engineer). CLI startup is
included. These are observations, not CI timing thresholds or live throughput.

Final verification: full deterministic suite **196 passed**; lint passed. Focused
filter/ATS/cache suite: **39 passed each** on Node 20.20.2, 22.23.4 and 24.22.1.
Tests cover all experience/employment choices, true/false unknowns, combined filters,
metadata conflicts, invalid dates/options, exact/detail cache reuse, changed filters,
limits, budgets, progress, saved/exported output and provider isolation. The existing
CI matrix remains offline; no live requests were added to CI.

No live LinkedIn comparison was run: its current [robots notice](https://www.linkedin.com/robots.txt)
requires express permission and disallows the guest route; no authorization is
recorded. The [User Agreement](https://www.linkedin.com/legal/user-agreement) was
also reviewed. Live behavior of the parameter mappings and new keyword hints
therefore remains unverified. Existing HTTP block handling is retained; no access
workaround was introduced. Other providers' deterministic integration tests pass;
no new live ATS availability claim is made in this audit.

Remaining limits: exact normalized employer matching cannot establish corporate
relationships or aliases absent source evidence; location matching cannot geocode
ambiguous names; coarse dates and absent metadata can reduce coverage. Partial
coverage is reported. Broader employer-authorized fixtures and permitted low-volume
live comparisons are the next validation step, not an increase in request budgets.
