---
id: B790
title: A journal can be created with a currency that is not one, and it can never be corrected
type: ISSUE
priority: medium
complexity: low
area: api, journals, currency
found: "2026-09-07T14:43:11Z"
started: "2026-09-08T19:14:15Z"
session: bdd0270d-3797-42c9-8687-06abecadbc63
claimed: "2026-09-08T19:14:15Z"
---

# B790 — A journal can be created with a currency that is not one, and it can never be corrected

## Why

B777 fixed the asymmetry one way round — create validated languages, correct
did not. This is the same asymmetry running the other way, and it is worse
because the field cannot be corrected at all.

`app/api/v1/journals/route.ts:297-298` passes `baseCurrency` and
`displayCurrencies` straight into `createJournal`, which writes
`input.baseCurrency ?? "CHF"` (`lib/journals.ts:272-275`) with no
`normalizeCurrency`, no three-letter check, and no check that
`displayCurrencies` contains the base. `setJournalProfile`
(`lib/journals.ts:1060-1089`) enforces all three — but `baseCurrency` is
refused there, deliberately, because a journal's base currency is what every
cost in it is denominated against and changing it later would silently
re-price the past.

So a journal created with `"francs"`, or `"chf "`, or nothing sensible at all,
is stuck with it forever, and the one route that would have caught it is the
one that never runs on it.

Found while fixing B777.

## Work

Validate both fields in the create route against the same helpers
`setJournalProfile` uses — imported, not copied, the way B777 now shares
`MAINTAINED_LOCALES`. Refuse with the same words.

## Acceptance

A currency refused when correcting a journal is refused when creating one, and
a test asserts the two routes share one validator.

## Found on pickup

The fix described in Work was already in the tree by the time this session
took the task — landed as part of B839 ("the currency nobody can change is
the currency everybody is asked"), which required `baseCurrency` on
`POST /api/v1/journals` and validates it and `displayCurrencies` with
`normalizeCurrency` (`app/api/v1/journals/route.ts:280-332`), the same
function `setJournalProfile` calls for both fields (`lib/journals.ts:1086`,
`:1096`, `:1125`) — imported from `lib/currency.ts` in both files, never
copied. `test/journals-required-fields.test.ts`'s
`"B839 — the currency nobody can change…"` block already proves the create
route refuses `"francs"`, `"EURO"`, `""`, `"ch"`, and refuses
`displayCurrencies` missing the base.

What was missing was the acceptance line's second half — a test asserting the
two *routes* (create and correct), not just the create route alone, refuse
identically because they share the helper. Added
`"B790 — creating and correcting a journal refuse the same currencies,
because they share one check"` to that file: it runs `"francs"` through both
`POST /api/v1/journals` (`displayCurrencies`) and `setJournalProfile` and
gets refused both times, then runs `" chf "` through both and gets the same
`"CHF"` out of both — proving one shared normalizer rather than two
independent copies that could drift.

Acceptance, evidence:
- "A currency refused when correcting a journal is refused when creating
  one" — the new test's first half: `setJournalProfile(..., {
  displayCurrencies: ["francs"] })` refuses, and
  `POST /api/v1/journals` with `displayCurrencies: ["francs"]` also answers
  400 and writes nothing.
- "a test asserts the two routes share one validator" — the new test's
  second half: both routes normalize `" chf "` to `"CHF"` identically, which
  only holds if both call the same `normalizeCurrency`.

`npx vitest run test/journals-required-fields.test.ts` — 19 passed.
`npx vitest run test/journals-required-fields.test.ts test/currency.test.ts
test/journals.test.ts` — 131 passed, everything the diff touches or could
plausibly affect.

`npm run verify` in full failed twice on this checkout, on unrelated tests,
and neither run touched anything this diff changed:

- `test/task-ids.test.ts` — fails reliably, on `main` before this session
  touched anything: five files under `docs/tasks/backlog/wont-do/` have no
  `wontDo:` field and `type: OPS`, so the derived folder is `backlog/ops/`
  and the actual one disagrees. Captured as B1023 rather than fixed here —
  deciding whether each is truly wont-do or was misfiled is a person's call
  per AGENTS.md ("`wontDo` is a person's word, not an agent's"), not
  something to guess at while closing an unrelated currency ticket.
- `test/locales.test.ts`, `test/media-upload.test.ts`, `test/postcard.test.ts`,
  `test/generator-output.test.ts`, `test/ingest-run.test.ts`,
  `test/status-script.test.ts` — a different subset failed each run, all on
  `Error: Test timed out in 30000ms`. Re-ran `test/locales.test.ts` alone (no
  other suite competing for the CPU) and it still took 32.7s against the
  30s budget — this is machine contention on a shared box running several
  agents at once (AGENTS.md says as much), not a correctness fault, and not
  something this diff introduced or can fix.

Neither failure set mentions `journals`, `currency`, or anything this ticket
touched.
