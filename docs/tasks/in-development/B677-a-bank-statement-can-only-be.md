---
id: B677
title: A bank statement can only be read on the owner's own laptop, so the parsing lives in the helper
type: FEATURE
priority: medium
complexity: high
area: importers, api, costs
found: "2026-09-07T09:07:35Z"
started: "2026-09-07T09:15:40Z"
session: 1d31e523-3a22-4905-82fd-39e3d55289f5
claimed: "2026-09-07T09:15:40Z"
---

# B677 — A bank statement can only be read on the owner's own laptop, so the parsing lives in the helper

## Why

TODO — the problem, not the fix.

## Work

TODO

## What changed while building

**`lib/statements/`, not `lib/costs/`.** A `lib/costs.ts` file already exists,
and a directory of the same name beside it is a resolution trap waiting for
somebody's `@/lib/costs` import. The module is named for what it reads.

**The row is a `Payment`, not a `Cost`.** What a bank line *is* — a date, an
amount, a currency, a merchant's own name — with the sign the statement wrote
and an optional `charged` for what it came to in the account's currency. The
last of those is where a real exchange rate comes from, and reading the
merchant's column as the cost is how a trip is recorded in the wrong currency.

**The apply call is writable by anybody who may write the trip**, trip-scoped
tokens included — unlike the import, which is the owner's. It takes rows a
person has already agreed and puts them on days of one trip; it reads no
statement and reaches nowhere else. Refusing it to somebody on the trip would
have been a rule with no threat behind it.

**A test fixture taught me the parser's one sharp edge.** Written with the date
unquoted — `Jun 22, 2026,Padaria…` — every row silently vanished, because the
comma inside the date shifted every column. A real statement quotes it. The
contract check catches it loudly as "parse returned nothing", which is the
right failure; the fixture is now what a bank actually writes, and says so.

**The B671 route test used `costs` as its example of an unknown kind**, which
stopped being one. It now uses a word nobody will implement, and has a sibling
asserting that an *absent* kind is refused too.

## Acceptance

TODO

## Why

B671 made `POST /api/v1/<user>/import` take a **kind** and a **format** so that
the second kind of data would be the same call with different words. This is
that second kind, and it is already written — in the wrong repository.

`fernscout-helper` carries `revolut-costs`: 122 lines that parse a Revolut
consolidated statement into dated, currency-tagged amounts, and 79 more that
write them into a trip's costs. **None of it needs to run on the owner's
machine.** Once the CSV has been uploaded, parsing it is arithmetic — the same
arithmetic for everyone, on a server that already has the trip, its dates, its
base currency and its rates table.

That leaves the helper doing something it is bad at: every instance's owner
needs a checkout, a Node, and the version of the parser that happens to be on
their disk. A statement format changes and it changes for one laptop at a time.

The boundary the helper should keep is **what cannot run here**: reaching into
a Photos library, an iCloud export, a PDF that never leaves the machine. Turning
a file into rows is not on that list.

## Work

**`importers/costs/`**, beside `importers/gps/`, the same shape and the same
MIT licence:

```
importers/costs/
  schema.ts     Cost — date, amount, currency, description; CostsImporter;
                checkCostsImporter
  index.ts      COSTS_IMPORTERS
  revolut.ts    ported from fernscout-helper's parse.mjs
```

A `Cost` row is what a statement line *is*, not what a `costs.md` entry is:
`{ date, amount, currency, description }`, and nothing about categories. The
category is an editorial decision — was that restaurant "food" or "the one
good dinner" — and AGENTS.md's rule applies: an agent does not decide what
happened. Absent, and asked.

**`kind: "costs"` on the existing route.** Same request shape, same three doors
for the bytes, same `dryRun`. It answers with the rows it read, grouped by day,
and **writes nothing into a trip by itself** — because a statement covering a
fortnight contains the trip and the fortnight either side of it, and only a
person knows which lines were the trip.

**Where the rows go is a second call**, exactly as `…/trips/<trip>/track` is
the second call for positions:

```
POST /api/v1/<user>/trips/<trip>/costs/import   { rows: [...], category: … }
```

taking back the rows the import answered with, so the person has seen them.
The existing costs routes already own writing `costs.md`; this is a shape
change, not a second writer.

**`IMPORT_KINDS` becomes two**, and the moment it does, an absent `kind` has to
be refused rather than defaulted to `gps` — reading a bank statement as
positions is not a mistake to make quietly. `lib/gps/api.ts` also stops being
the right name for a module that now dispatches two kinds; it becomes
`lib/import/api.ts` with a per-kind writer behind it.

**Then the helper changes** (its own repository, no task file here): the
`revolut-costs` skill stops parsing and starts uploading — find the statement
on the machine, `POST /inbox`, `POST /import` with `kind: costs`, show the
person the rows, ask which are the trip's, send the second call. Its parser is
deleted rather than kept as a fallback, for the reason B671 gave for deleting
the CLI: the unexercised door is the one that rots.

## What changed while building

**`lib/statements/`, not `lib/costs/`.** A `lib/costs.ts` file already exists,
and a directory of the same name beside it is a resolution trap waiting for
somebody's `@/lib/costs` import. The module is named for what it reads.

**The row is a `Payment`, not a `Cost`.** What a bank line *is* — a date, an
amount, a currency, a merchant's own name — with the sign the statement wrote
and an optional `charged` for what it came to in the account's currency. The
last of those is where a real exchange rate comes from, and reading the
merchant's column as the cost is how a trip is recorded in the wrong currency.

**The apply call is writable by anybody who may write the trip**, trip-scoped
tokens included — unlike the import, which is the owner's. It takes rows a
person has already agreed and puts them on days of one trip; it reads no
statement and reaches nowhere else. Refusing it to somebody on the trip would
have been a rule with no threat behind it.

**A test fixture taught me the parser's one sharp edge.** Written with the date
unquoted — `Jun 22, 2026,Padaria…` — every row silently vanished, because the
comma inside the date shifted every column. A real statement quotes it. The
contract check catches it loudly as "parse returned nothing", which is the
right failure; the fixture is now what a bank actually writes, and says so.

**The B671 route test used `costs` as its example of an unknown kind**, which
stopped being one. It now uses a word nobody will implement, and has a sibling
asserting that an *absent* kind is refused too.

## Acceptance

- `POST /api/v1/<user>/import` with `kind: costs` reads a real Revolut export
  and answers with dated rows and no categories.
- An absent `kind` is refused once there are two, with both named.
- `dryRun` writes nothing; the rows come back either way.
- No row reaches `costs.md` without the second call naming the trip.
- The helper's `revolut-costs` runs end to end against a local instance with
  no parsing of its own.
- `/openapi.json` documents the kind and the second route; `/agent.md` carries
  the workflow.
- `npm run verify` and `npm run unused` pass.

## What was verified

Against a running dev server, over HTTP, with an invented ten-line statement
covering a trip and the fortnight either side of it:

| | |
| --- | --- |
| `GET /import` | two kinds, each with what it is for and its formats |
| No `kind` | refused — *"Say what kind of data this is. Known kinds: gps, costs"* |
| Staged, then read with the trip's window | `revolut` detected, 10 rows read, 6 spending, 1 transfer counted and left out |
| The rent, dated a week after the trip | outside the window, absent from the totals |
| Rates | `EUR: 0.94`, from the money the bank moved |
| Categories anywhere in the answer | none — asserted on the response body |
| Days carrying costs afterwards | unchanged: the import wrote nothing |
| The second call, with agreed categories | 3 costs across 2 days; the hand-written one on the second day kept |
| A date whose day was 07:00 and 21:00 | written on the 07:00 one |
| A date with no day | `orphaned`, nothing written, and said so |
| Bad rows | `invalid_costs` naming all five fields at once |
| A GPX sent as `revolut` | `unreadable`, saying it was the format you named |
| `format: monzo` | `unknown_format`, naming the one that exists |

Then the same loop through the rewritten helper skill, which parses nothing:
it staged the file, printed the merchants biggest-first, wrote a file of rows
with `category: null`, **refused to send them** until a person filled them in,
and then wrote 5 costs across 2 days keeping 4 that were already there.
