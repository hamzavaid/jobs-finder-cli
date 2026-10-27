# Engineering summary

This is the earlier HTML-provider audit record. For the current six-provider ATS
pipeline, see [ATS_VALIDATION.md](ATS_VALIDATION.md).

Completed 2026-10-27. Work followed six sequential phases with a Git commit per
phase. No external API credentials, paid services, proxies, required accounts or
browser automation were introduced.

## Delivered behavior

- LinkedIn, Indeed and Glassdoor have reusable provider descriptors, a shared
  bounded search loop and a nullable normalized record schema. Glassdoor parses
  public DOM cards and JSON-LD graphs/lists, retains salary attribution and checks
  robots rules before page requests. No internal API or client-side script is used.
- `find` and `url` default to all three sources. Actual CLI tests cover variadic,
  repeated, mixed-case and comma-separated provider arguments. Detail URLs are
  source-validated; saved/export/stats support source filters, and doctor reports
  each selected provider independently.
- Search failures are isolated, accepted partial results survive later failures,
  IDs are deduplicated per source, and merged results interleave within a total cap.
- HTTP concurrency is one, shared across sources and callers. Start spacing,
  body-inclusive timeouts, bounded transient retries, body cancellation and immediate
  stopping on restrictions replace the former racing request schedule.
- Filters reject observed contradictions, treat unknown false values correctly,
  distinguish unsupported criteria from unverified URL facets, and preserve the
  independent meaning of employment and experience.
- Persistence uses provider-qualified IDs, legacy migration, serialized in-process
  writes, cross-process exclusion, unique atomic replacement files and cleanup.
  Corrupt input is preserved and reported. Stats aggregate in linear time.
- JSON/JSONL preserve records; CSV adds salary/description/evidence while keeping
  existing column order before the added columns. CSV formula protection and table
  terminal sanitization are tested.

## Validation

| Check | Result |
| --- | --- |
| Baseline | 31 tests passed; original syntax lint passed |
| Final deterministic suite | **73 passed, 0 failed, 0 skipped** |
| Runtime compatibility | Final suite passed locally on Windows with Node 20, 22, 24 and installed Node 25 |
| Clean installation | `npm ci` succeeded from package-lock.json |
| Dependency advisory check | `npm audit`: zero known vulnerabilities at verification time |
| Syntax lint | All JavaScript in bin/src/test/scripts passed |
| Whitespace | `git diff --check` passed |
| CI workflow | YAML parsed and manually reviewed; official action revisions resolved from GitHub release tags |
| Live LinkedIn smoke | Three normalized cards parsed from one public page |
| Live Indeed smoke | HTTP 403; stopped without retries/bypass |
| Live Glassdoor smoke | HTTP 403; stopped without retries/bypass |

Standard tests use local fixtures and mocked fetch, including real CLI subprocesses;
they do not access job websites. Live smoke is a separate explicit command and
returned exit 1 because two providers were restricted. That expected live failure
does not turn into a passing extraction claim.

The GitHub workflow installs, lints, tests and checks offline CLI behavior on
Node 20/22/24 across Ubuntu and Windows. It uses read-only permissions, does not
persist checkout credentials, pins official v6 actions to immutable revisions,
and does not scrape live providers. The hosted workflow has not been executed in
this session; local Windows tests do not prove that the Ubuntu jobs have run.

## Independent final review

A separate read-through reviewed every source module, new tests/scripts, manifest,
lockfile, workflow and documentation after implementation. It caught and corrected
employer-versus-job verification confusion, calendar-date contradictions, ambiguous
employment/seniority matching, detail metadata for the wrong Glassdoor ID, permissive
Indeed empty-page detection, query-text ID extraction, entity decoding, login
redirect handling and terminal controls in stored IDs. Regression coverage was added
before the final runtime matrix checks. Final CI review also upgraded pinned actions
to their current v6 tags and disabled persisted checkout credentials.

## Remaining limits and recommended follow-up

1. **Live Indeed and Glassdoor extraction is unverified.** HTTP 403 is an external
   access restriction. Their parsers are fixture-tested contracts, not proof that
   current authenticated or blocked markup can be fetched. Do not add bypasses.
2. Glassdoor pagination is limited to permitted public next anchors. Current crawl
   rules and client-only loading can prevent further pages. Location is a local
   substring, not geographical matching. No unverified Glassdoor server facets are
   claimed. Unsupported unknown criteria exclude candidates.
3. LinkedIn/Indeed URL filters may change or be ignored. Unconfirmed facet labels
   disclose this; strict mode excludes them. A successful one-page live check does
   not establish every detail page, filter or pagination path.
4. Collect small, authorized, redacted live fixtures when providers permit access;
   include locale and markup variants. The new Glassdoor fixtures are synthetic.
5. Keep periodic npm advisory checks and run the committed CI on GitHub. Lint is a
   syntax check, not a full static style/security analyzer. The current dependency
   tree emits a transitive `whatwg-encoding` deprecation warning; it has no reported
   advisory in this check and was retained to avoid an unrelated parser upgrade.
6. Storage is a small local JSON database. A crashed writer may leave a lock requiring
   manual confirmation/removal. Atomic rename prevents partial normal writes but
   does not promise power-loss durability; fsync or an embedded transactional store
   could be justified for larger or more critical datasets.

See [QUALITY_AUDIT.md](QUALITY_AUDIT.md) for prioritized root causes and resolution
history and [GLASSDOOR_RESEARCH.md](GLASSDOOR_RESEARCH.md) for primary-source research.
