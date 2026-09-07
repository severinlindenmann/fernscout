---
id: B677
title: A bank statement can only be read on the owner's own laptop, so the parsing lives in the helper
type: FEATURE
priority: medium
complexity: high
area: importers, api, costs
found: "2026-09-07T09:07:35Z"
---

# B677 — A bank statement can only be read on the owner's own laptop, so the parsing lives in the helper

## Why

TODO — the problem, not the fix.

## Work

TODO

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
