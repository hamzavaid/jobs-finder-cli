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
