# v2 migration — the eight waves (summary; the full plan is the artifact)

Full plan with gates and rollback per wave:
https://claude.ai/code/artifact/c3bee44b-5e2e-476f-af43-8f5a7409bae9

Principle: v2 shares the domain layer and storage with v1 — one writer per
file, so every wave until 7 is additive and rollback is "redeploy the
previous tag". Cross-cutting nets from wave 0: golden corpus (byte-identical
round trip over every real file, unknown keys preserved), parity suite
(same write via v1 and v2 → identical file, quirk ledger), import-boundary
test, B1090 checks on pre-existing content, per-token request logging.

| Wave | Ships | Risk | Gate in one line |
|---|---|---|---|
| 0 | Frozen schemas (V/T folded), serializer + golden corpus, describeScope, openapi generation | none | verify + corpus green over live-journal copies |
| 1 | All v2 GETs, /openapi.json, generated docs, request logging; figures dual-read shim | low | read-parity vs v1 on live content |
| 2 | v2 write core in parallel; v1 untouched; Deprecation headers on v1 | med | parity suite + live B540-style test-journal drive |
| 3 | Auth merge (old routes stay aliases), invites/contacts, money reads, postcards PUT, journals create; figures migration script runs (backup first) | med | full auth matrix local + live signup drill |
| 4 | Helper onto v2 via in-process cookie proxy, one tool area per merge, old helper routes deleted as repointed; declined-matcher with the first declining tool | high | persona round per area |
| 5 | Webapp pages one by one: EditDay proxies, me/*, admin, stragglers die | med | test-in-a-browser per page, 390px, old content |
| 6 | Soak 2–4 weeks; Sunset date announced only when request logs show no third-party v1 writes | low | testing/ lane empty, logs quiet |
| 7 | v1 → 410 one release, then deleted (openapi.ts, v1 tree, aliases, parity suite, dual-read shim, doors); AGENTS.md rewritten | high | full verify + persona + live e2e; superseded tickets closed by a person |

Rules: a wave starts only after the previous wave's tickets left testing/
through a person; nothing is deleted in the wave that replaces it; surprises
become tickets, never silent scope.
