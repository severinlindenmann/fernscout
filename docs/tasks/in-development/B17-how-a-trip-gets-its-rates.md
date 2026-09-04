---
id: B17
title: How a trip gets its rates is written down nowhere a person will find it
type: CHORE
priority: medium
complexity: low
area: currency, docs
found: "2026-09-01"
started: "2026-09-04T06:22:41Z"
session: 2b6d1969-424a-4788-9497-eb5e151a5391
claimed: "2026-09-04T06:22:41Z"
---

# B17 — How a trip gets its rates

## Why

The currency model itself is sound and it is not what this task is about.
`lib/currency.ts:1–17` sets out three layers, and every one of them is
implemented and self-reporting: an unconvertible cost carries `base:
undefined` rather than a plausible number (`lib/costFormat.ts:44–52`), and the
page says so out loud through `unconvertedIn()` and `UnconvertedNotice`
(`app/[user]/(trip)/costs/CostsPageContent.tsx:51`), naming the currency and
pointing at `trip.md`.

The problem is that an author cannot find any of this, and cannot find out
what number to write.

**The document exists and is unreachable.** `docs/currencies.md` is the
explanation — three layers, worked examples, the manual-rate escape hatch. It
now lives at `docs/archiv/currencies.md`, and the README still links it as
`docs/currencies.md` (`README.md:120`), which resolves to nothing. B09 is
repointing links wholesale; the question this task asks is whether money is
current documentation that belongs back out of the archive, and the answer is
yes.

> **Stale as of 2026-09-04, and the answer stands.** B09 landed and did exactly
> this: `docs/currencies.md` is out of the archive, linked from `README.md:150`
> and from the new `docs/README.md:13`, and `test/docs-links.test.ts` now fails
> the build if either link breaks again. So the first half of work item 1 is
> done and was not done here. What was left is everything below.

**Two rate tables are easy to mistake for each other.** They have opposite
conventions, both are called "rates", and only the docblock in
`lib/currency.ts:19–28` says which is which:

| | Where | Means |
| --- | --- | --- |
| trip `rates:` | `trip.md` frontmatter | units of **base** per 1 unit of the keyed currency — `THB: 0.0245` is "1 THB = 0.0245 CHF" |
| ECB table | `content/rates/ecb.json` | units of the **keyed currency** per 1 EUR — `CHF: 0.9364` is "1 EUR = 0.9364 CHF" |

Getting them the wrong way round produces a page full of numbers that are
wrong by four orders of magnitude and no error anywhere.

**Nothing produces the trip number.** `npm run rates:update` refreshes
`content/rates/ecb.json` — that is layer three, the reader's own currency. The
frozen per-trip table of layer two is typed by hand from somewhere the author
has to find themselves. There is no command that proposes one, and no check
that a trip's `rates:` covers the currencies its costs are actually written
in. The demo trips each carry one or two rates that happen to be right.

`site.manualRates` (`lib/config.ts:215`) is a third thing again, for
currencies the ECB does not publish, and is not in `content/config.json` at
all — so the one worked example of it is a comment in
`scripts/update-rates.mjs:11`.

## Work

1. Bring `currencies.md` back out of `docs/archiv/` as current documentation
   and repoint the README row. Add the two-table comparison above to it, in
   those words — it is the mistake the model invites.
2. Say in `.claude/skills/add-a-trip/SKILL.md` where the number comes from.
   The skill defines `rates:` (`SKILL.md:85–88`) but not how to obtain a value
   an author can defend a year later. Name a source and the convention.
3. Add a check: for each trip, every currency appearing in `costs.md` or an
   entry's cost that is not the base currency and not in `rates:`. Cheapest
   place is a test over `content/example`, which then also proves the demo
   content is coherent; a warning from `npm run tasks`-style tooling is the
   larger version. It must not be a build failure — an unconvertible cost is
   a supported state, deliberately.
4. Consider extending `npm run rates:update` with a mode that prints today's
   ECB cross-rate for a currency pair, so the author has something to paste.
   Do **not** make it write into `trip.md`: a frozen historical rate is a
   judgement about what a trip actually cost, not a lookup.

## What was done

**1. The two tables.** `docs/currencies.md` gains "Two tables called 'rates',
pointing opposite ways" — the comparison table from the Why, in those words,
plus the rule of thumb that makes it checkable without thinking it through
again: *a trip rate for a currency worth less than your base currency is a
small number.* `THB: 0.0245` is right; `THB: 40.8` is the ECB's direction
written into the wrong file. It also notes that `lib/currency.ts` is the only
place in the code stating both conventions, which is true and is why this was
findable at all.

**2. Where the number comes from.** A new section of `docs/currencies.md`, and
a longer version of the `rates` bullet in `.claude/skills/add-a-trip/SKILL.md`.
Both say the same three things, in order of how defensible the number is a
year later: a card statement or withdrawal receipt (the amount debited divided
by the amount received — the only figure that includes the spread actually
paid), an ECB rate for a date in the middle of the trip, cross-divided when the
base currency is not the euro (`base per 1 XYZ = (base per EUR) ÷ (XYZ per
EUR)`), or any rate whose provenance can be written down. Both say never
today's rate for a trip in the past, and both say an omitted currency is a
supported state rather than a failure — the page reports it, and an empty field
beats a number nobody can defend, which is the house rule everywhere else here.

**3. The check already existed.** `test/example-content.test.ts`, "every trip's
spend converts, in every currency it was spent in", asserts
`getCostSummary(trip.ref).unconverted` is empty for every demo trip.
`getAllCosts` (`lib/costs.ts:103`) covers `costs.md` preparation lines *and*
every entry's costs, so the coverage the Work asked for is there and this task
was written without noticing it. What it did not do is name the currency: the
message said only "has amounts it could not convert". It now asserts on
`unconverted.map(u => u.currency)` with the message "`<ref>` spends in a
currency missing from its rates: block in trip.md", so a failure states the
edit rather than the symptom. A comment records why this may never be a build
failure.

**4. Not done, captured as B216.** The Work said "consider", the acceptance did
not ask for it, and it is a feature rather than a correction. The constraint
the Work states — print a figure, never write into `trip.md` — is carried over
into the capture as the constraint rather than as a nicety.

## Acceptance

- `docs/currencies.md` resolves from the README, and explains both tables and
  which direction each one goes.
- `add-a-trip` tells an author where the `rates:` number comes from.
- A trip with a cost in a currency missing from `rates:` is reported by a
  test or a command, naming the trip and the currency. The page keeps
  rendering.
- `npx vitest run` passes; the demo content has no missing rate.
