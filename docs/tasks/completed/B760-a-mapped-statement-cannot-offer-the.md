---
id: B760
title: A mapped statement cannot offer the exchange rates a known one can
type: ISSUE
priority: low
complexity: low
area: agent, costs
found: "2026-09-07T13:57:56Z"
started: "2026-09-08T20:52:47Z"
merged: "2026-09-08T21:13:36Z"
completed: "2026-09-09T16:46:00Z"
---

# B760 — A mapped statement cannot offer the exchange rates a known one can

## Why

`lib/statements/read.ts` derives `rates` for `trip.md` from the `charged`
pairs a known bank's export carries — what the bank actually charged in the
home currency against what the merchant billed. That is the honest exchange
rate for a trip, better than any published one, and it flows out through
`POST /api/v1/<user>/import` (`app/api/v1/[user]/import/route.ts`), which tells
an agent to `PUT` the rates onto the trip when they are there.

`importers/costs/mapping.ts`'s `applyMapping` (B689) only ever reads **one**
amount column, so a `Payment` it produces never carries `charged` — confirmed
still true by reading `applyMapping` line by line: the `row` it builds has
`date`, `amount`, `currency`, `description`, `account`, and nothing else.
`readStatement`'s median-rate calculation is therefore always empty for a
mapped statement, and it is completely silent about that: nothing tells the
person who fed in a mapped CSV that a dedicated importer's statement would
have offered them exchange rates and theirs did not.

The place that silence actually lands is not the agent REST route above —
`chooseImporter` in `lib/statements/read.ts` only knows the importers in
`importers/costs/index.ts` (just `revolut`), so a statement nothing recognises
is refused there with `unknown_format` before mapping ever enters the
picture. A mapped statement is only ever read through the web helper's own
two-call flow: `POST /api/helper/[user]/statement` (asks a model for the
column mapping) and `POST /api/helper/[user]/statement/apply`
(`app/api/helper/[user]/statement/apply/route.ts`), which calls `applyMapping`
directly and was returning `read`, `outside`, `spending` and `truncated` —
never a word about rates, for a mapped statement or a known one. That route,
and the `Mapping` screen in `components/AgentInbox.tsx` it feeds, is the one
place a mapped statement is ever shown to anybody, so it is the one place the
sentence belongs. Confirmed still real; no sibling task covered it.

## Work

Took the Work section's second option: a sentence on the mapping screen, not a
second amount column — a billed-amount column would still need a person to
have one to give, and most exports of a bank this instance has never seen
simply do not carry one.

- `components/AgentInbox.tsx`: the `Mapping` component (now exported, for the
  test below) takes a new `dedicatedImporters: string[]` prop and renders
  `agent.inboxMappingNoRates` — naming the banks that do offer rates — right
  above the "worth checking" notes, whenever the list is non-empty. `Mapping`
  is only ever shown for a mapped statement (a known one skips straight to
  reading the whole file), so no extra "is this mapped" condition was needed.
- `app/agent/[user]/inbox/page.tsx` passes `COSTS_IMPORTERS.map(i => i.label)`
  as that prop — today just `["Revolut consolidated statement (CSV)"]` — so
  the sentence stays true as importers are added, with no second list to
  drift.
- `site/locales/{en,de,hu}.json`: `agent.inboxMappingNoRates`, with a
  `{banks}` placeholder.
- Not touched: `readStatement`, `applyMapping`, the mapping schema, or the
  REST `/api/v1/<user>/import` route — none of them are on the path a mapped
  statement actually takes today, and none needed to change to answer this
  ticket.

## Acceptance

Somebody importing a mapped statement knows whether rates were available and
why not.

- Reading a mapped statement's `Mapping` screen now always shows, when this
  instance has at least one dedicated importer: "Exchange rates worked out
  from what this actually cost are only offered for statements read by a
  dedicated importer (Revolut consolidated statement (CSV)). This one was
  read from its own columns, so none are offered here." — in English, German
  and Hungarian.
- A known-format statement never reaches `Mapping` at all (it goes straight to
  `readWholeFile`), so the sentence is never shown where it would not apply.
- `test/agent-inbox-rates-note.test.tsx` renders `Mapping` directly: with a
  dedicated importer named, the sentence and the bank's label are both in the
  markup; with none, the sentence is absent. Both pass.
- `npm run verify` passes in full: build, `tsc`, `eslint`, 449 test files /
  5796 tests, `knip` — nothing else moved.
