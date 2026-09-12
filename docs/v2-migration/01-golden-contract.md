# The golden contract — where the truth lives

Every build step is measured against these, never against memory or this
folder's prose. If prose and schema disagree, the schema wins and the prose
gets fixed.

1. **The Zod schemas** — `lib/api/v2/schemas/` (shared, day, trip, journal,
   figures, media, status, index). These are reviewed, frozen, and tested
   (`test/api-v2-schemas.test.ts`, 30 tests). Change them only for a bug or
   an owner decision, and extend the tests in the same commit.
2. **The generated OpenAPI** — `docs/plans/2026-09-12-api-v2/openapi.json`
   (96 paths / 125 operations / 114 schemas). Core component schemas were
   generated from the Zod source (z.toJSONSchema, io:"input",
   unrepresentable:"any" — run it through vitest, `server-only` blocks
   plain node). Area paths transcribe the area contracts. As routes are
   BUILT, regenerate this from code so it stops being a concept document
   and becomes the served /api/v2/openapi.json.
3. **The area contracts** — `docs/plans/2026-09-12-api-v2/{auth,social,
   print,money,web,content}.md`. Full field tables, examples, refusals,
   per-file migration ledgers. Where one conflicts with the synthesis calls
   (S1-S4) or verdicts (V1-V13) in 00-decisions.md, the decision wins.
4. **The challenge reviews** — `docs/plans/2026-09-12-api-v2/challenge-*.md`
   — read before building the area they touch; the verdicts are decided,
   the reasoning is context.
5. **The ticket scan** — `docs/plans/2026-09-12-api-v2/tickets.md` — which
   existing tickets v2 absorbs (T1-T6), collides with (B1567, B1585/B1591,
   B1577), or supersedes (B1520, B1525, B1577, B1584, B1586, B1028, B1384,
   B1547 — the owner closes them, not you).

## Design rules for every route you build

- schema.parse -> shared domain function -> full stored-document echo.
- Every refusal is the error envelope; every code is in
  lib/api/errorCodes.ts; the 422 incomplete body lists EVERY missing
  section with why_required, a schema excerpt, and to_decline.
- Enums imported from the constant the validator uses. Never retyped.
- dryRun on every write (T1). ETag on every document GET (V11). PUT for
  client-chosen-id creates (S2). Cursor pagination on lists (V12).
- Server-owned fields refused in writes unless byte-identical to stored
  (echo-tolerant writes, V2/evolution finding 2).
- Decline retraction: a write supplying a previously-declined section
  clears the stored decline — in the shared write path, once (T6).
- One writable-fields list per resource, shared by the /api/web cookie door
  and the /api/v2 bearer door, with a test (T5).
