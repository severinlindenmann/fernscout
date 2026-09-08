---
id: B973
title: A cost with no currency is filed in the base one without anybody being asked
type: ISSUE
priority: low
complexity: low
area: helper, costs
found: "2026-09-08T13:59:03Z"
started: "2026-09-08T21:40:12Z"
merged: "2026-09-08T21:48:42Z"
---

# B973 — A cost with no currency is filed in the base one without anybody being asked

## Why

`lib/helper/tools.ts`'s `add_cost` proposal (previously around line 986) drew
its `currency` field as `args.currency ?? ""`: *"We spent 15 on the museum"*
produced a proposal with `currency: ""` on the card, and the route
(`app/api/helper/[user]/day/costs/route.ts`, via `lib/costs.ts`) has always
read an empty currency as the trip's base one — right for every day written
before multi-currency existed, and never said aloud since.

Defaulting is right; what was missing is that nobody was told. On a trip based
in CHF while the person is standing in Portugal saying "fifteen", the guess is
wrong half the time, and it shows up much later as a total that just feels
about right.

Found beside B960 and B959, which are the same subject from the other end: the
totals are now honest about what they *could not* convert, and this was money
quietly converted by assumption instead.

## Work

The card, not the route — confirmed still real by reading
`app/api/helper/[user]/day/costs/route.ts` and `lib/costs.ts` on this branch:
neither has changed since the ticket was found, and no sibling task in
`docs/tasks/` covers this one (B960/B959 are the total-side honesty, not the
proposal card).

`add_cost`'s `propose` in `lib/helper/tools.ts` now resolves the trip's own
`{ base, rates }` via the already-exported `conversionFor()` (`lib/costs.ts`)
— the same base currency and rates the route itself would use, so there is no
second opinion on what "the base" means. The `currency` field's value is the
normalized amount the person said (`normalizeCurrency`, uppercased) when they
said one, and the trip's base currency otherwise; its `options` list the
trip's own currencies — the base plus anything already in the trip's `rates:`
table — only when there is more than nothing to offer. A trip that resolves to
nothing (no trip yet) still gets an empty field exactly as before.

Not doing: refusing a cost with no currency. That would break every existing
day on disk and would be a worse answer than a visible default. Not doing:
validating a currency the person *did* name against a fixed list — that is a
separate question from this ticket, which is only about the unstated case.

## Acceptance

A cost proposed without a currency shows which one it will be filed in, before
the press.

- Verified by `test/helper-cost-currency-default.test.ts`: proposing `add_cost`
  with no `currency` on a trip whose journal `baseCurrency` is `CHF` returns a
  `currency` field with `value: "CHF"` and a non-empty `options` list (base
  plus the trip's `rates:` keys); proposing it with `currency: "eur"` keeps
  `EUR` (normalized), not the base.
- Confirmed the test fails on the pre-fix code (`git stash` of
  `lib/helper/tools.ts` alone): the first case reports `value: ""` instead of
  `"CHF"`.
