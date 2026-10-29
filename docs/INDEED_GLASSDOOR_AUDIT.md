# Indeed / Glassdoor reliability audit

Baseline: 2026-10-29, commit `541ed1c7816e76429b9710bdceba8e8c11d7b093`.
`git pull --ff-only`: already current. `npm ci`: installed 24 packages;
`npm run lint`: passed; `npm test`: 168 passed, zero failures (32.44 s).
The user-supplied implementation specification is retained alongside this report.

## Confirmed issues before implementation

| Priority | Root cause | Required fix |
| --- | --- | --- |
| High | Glassdoor robots check treated public accessibility as sufficient permission | Explicit source policy and restricted outcome; document current terms |
| High | Search errors lacked machine-readable status; details could continue after a block | Classify errors; stop denied provider, preserve prior records and other sources |
| High | Neither HTML source persisted successful query/detail results or block cooldowns | Reuse atomic CacheManager with separate versioned HTML records |
| High | Indeed detail parser selected first JSON-LD posting without checking identity | Refuse cross-posting merges |
| High | Indeed isRemote=true took precedence over explicit hybrid metadata | Prefer observed workplace; retain ambiguous boolean as unknown |
| Medium | Only duplicate IDs terminated repeated pages; no URL visitation tracking or truthful page-budget coverage | Track next URLs and stop reasons; annotate partial results |
| Medium | Indeed parser lacked traversal/object/JSON extraction bounds | Bound untrusted structures and quarantine malformed candidates |
| Medium | Glassdoor detail URL validated a URL but not agreement with requested ID | Require same source identifier |
| Medium | Indeed location was never independently checked; URL facets counted as supported evidence | Local evidence checks, no unconfirmed facet acceptance for these sources |
| Medium | Glassdoor location is absent from the SEO route | Keep local filtering and disclose incomplete geographic scope |
| Medium | Shared JSON-LD traversal was recursive without a depth/item cap | Bounded graph traversal and typed fields |

No new dependencies, browser automation, hidden APIs, or unrelated provider rebuild
are required. Existing shared filtering, normalization, ranking, output, storage,
HTTP scheduler and per-website progress are retained. Live extraction remains an
external dependency; offline fixture success is not a live-access claim.

## Resolution and final review

Implemented in `c78330a`: access assessment, shared status classification, separate
query/detail/policy caches, persisted denial cooldown, same-ID checks, bounded
structured parsing, metadata reconciliation, truthful pagination coverage and
local evidence requirements. The listed high/medium code issues are addressed;
Glassdoor geographic scope remains explicitly incomplete rather than guessed.
The same access policy now applies to direct `job`, `doctor --probe` and smoke
entry points. A final regression ensures a blocked detail request retains a
verified summary with incomplete status and stops further requests.

The baseline failures were zero. Expanded tests initially exposed four confirmed
parser regressions (detail identity, hybrid precedence, evidence reconciliation,
and Glassdoor URL identity/salary attribution); tests failed before the fixes and
passed afterward. Two older tests were updated deliberately: Glassdoor no longer
scrapes without permission, and an Indeed URL date hint is no longer accepted as
proof of an observed posting date. CLI tests now use isolated temporary caches.

Final checks: `npm ci` passed; syntax lint passed; 184 deterministic tests passed.
The affected provider/HTTP/CLI suite passes on Node 20.20.2, 22.23.4 and 24.22.1.
`npm audit` reports zero vulnerabilities. The first sandboxed audit could not reach
the registry; the authorized registry check completed successfully. No dependencies
were added. The existing pinned Windows/Ubuntu Node 20/22/24 workflow was reviewed
and retained; remote GitHub Actions execution was not run here.

Independent final review covered the complete modified diff, cache atomicity and
pruning, failure/cancellation paths, URL checks, direct lookup/probe policy,
filter unknowns, source provenance, structured stdout and workflow commands.
Review fixes include retaining summaries after detail denial, avoiding details
for unsupported count/verification criteria, preserving valid results when cache
storage is unavailable, and expiring HTML artifacts without deleting a still-active
long Retry-After cooldown. Tests cover those paths.

Measured fixture CLI warm searches made zero requests in five separate processes;
cold 1,883 ms, warm p50 1,050 ms/p95 1,097 ms. This includes process startup and is
not a live performance claim. See [implementation evidence and filter matrix](INDEED_GLASSDOOR_IMPLEMENTATION.md).

Remaining blockers: **high/external** — no Glassdoor permission is recorded;
**high/external** — Indeed returned HTTP 403 in the optional public-policy smoke.
Both produced zero verified live jobs, with actionable diagnostics. Next action
is provider-approved access, not an evasive transport. **Medium** — new live page
schemas and locales remain unverified; extend synthetic or authorized fixtures
when reliable evidence is available. No optional browser/import workflow or
unauthorized structured adapter was added.
