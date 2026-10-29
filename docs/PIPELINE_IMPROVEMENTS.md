# Pipeline improvements

## Baseline and workflow
Baseline: 117 offline tests passed on Node 25.2.1 (2026-10-28). Existing six adapters, automatic inventory discovery, atomic cache storage and saved records are retained. No runtime dependencies added.

## Phase 1 — lexical retrieval
Implemented NFKC tokenization, explicit morphology and configurable equivalent aliases, quoted phrases, technical-token boundaries, available-signal scoring (40/25/20/10/5 defaults), structured filter decisions and deterministic global ranking. Each provider contributes a bounded candidate pool (at least 100, at most 1000), then global ranking applies the user limit. Explicit filters remain mandatory. Updated previous interleaving assertions because the requested ordering changed; count, concurrency and failure assertions remain. Baseline phrase behavior remains available for benchmarks.
