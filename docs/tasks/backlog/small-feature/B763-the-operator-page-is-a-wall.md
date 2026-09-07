---
id: B763
title: The operator page is a wall of tables that does not fit a phone
type: FEATURE
priority: medium
complexity: medium
area: admin, ops
found: "2026-09-07T16:20:00Z"
---

# B763 — The operator page is a wall of tables that does not fit a phone

## Why

`/admin` (B746) is four `<table>`s and a fifth inside every journal's ledger,
each with a `min-w-[30rem]`/`min-w-[36rem]` and an `overflow-x-auto` around it.
On a 390px screen that is five independently side-scrolling panes on one page,
and the cost column — the one number anybody opened the page for — is the one
off the right-hand edge. The `<summary>` row for each journal is worse: four
values and an `ml-auto` in a flex-wrap, which at phone width collapses into a
ragged stack with the money under the username.

It is also entirely numbers. An operator opening this wants three answers
before reading anything — *what does it cost*, *where does it go*, and *is it
growing* — and the first is the only one the page gives at a glance.

## Work

**Mobile.** Drop the tables. Every one of them is a list of rows with two to
four fields, which is a stacked block on a phone and a row on a desktop — no
horizontal scrolling anywhere, at any width. Keep the hero total.

**Charts.** Three, and each answers one of the questions above:

- *Where does it go* — a horizontal bar per group (models and speech, print,
  sends, fixed).
- *Which journal* — a horizontal bar per journal, so the comparison is a
  length rather than a column of francs to read against each other.
- *Is it growing* — model and speech spend per day across the window. This
  needs the one new query, `usageDailySince`, grouping `usage` by
  `substr(created_at, 1, 10)` — which is the same expression on SQLite and on
  Postgres, so it stays inside the rule that nothing outside `lib/db/` knows
  which is running.

Every chart is **one measure**, so each is a single hue and needs no legend and
no categorical palette: `navy-700`, which is 8.63:1 on `cream-50` — measured,
not guessed. `yellow-400` is 1.39:1 there and is not a data mark, which is the
same reason the brand notes say it is not a text colour. Values are printed on
the marks, so there is nothing a tooltip would add and no JavaScript is
shipped; the daily bars carry a `<title>` for the hover a pointer expects.

**Not doing:** a client-side chart library. Three bar charts are `<svg>` with a
`<rect>` each, and a dependency to draw a rectangle is a dependency to keep
patched forever.

## Acceptance

- At 390px nothing on `/admin` scrolls sideways, including inside a journal's
  ledger.
- The three charts render from the same numbers the rows below them show.
- No new dependency in `package.json`.
- `npm run verify` passes.
