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

## Acceptance

- `docs/currencies.md` resolves from the README, and explains both tables and
  which direction each one goes.
- `add-a-trip` tells an author where the `rates:` number comes from.
- A trip with a cost in a currency missing from `rates:` is reported by a
  test or a command, naming the trip and the currency. The page keeps
  rendering.
- `npx vitest run` passes; the demo content has no missing rate.
