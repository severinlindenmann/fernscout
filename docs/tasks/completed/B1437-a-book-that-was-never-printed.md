---
id: B1437
title: A book that was never printed is recorded as printed, because the status means built
type: ISSUE
priority: medium
complexity: medium
area: photobook, postcards, print orders, admin
found: "2026-09-11T10:28:29Z"
started: "2026-09-11T10:29:05Z"
merged: "2026-09-11T10:57:54Z"
---

# B1437 — A book that was never printed is recorded as printed, because the status means built

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

Found in the B911 engagement, 2026-09-11: six books were bought, all six were
refused by Gelato, all six were refunded — and all six rows read
`status: printed`. On the live instance right now, 62 photobook rows and 2
postcard rows say `printed`, and some number of those objects have never
existed on paper.

**The status is not lying about a transition; the word is wrong for the
state.** `printed` has always meant *the files are built and this row is open
for a print attempt*. `markPrinted` sets it when the PDFs are written
(`orders.ts:429`), before any printer is involved, and `markPrintFailed`
returns the row to it (`:513`) precisely so a refused order stays retryable —
which is right, and B1348 and B1165 both rest on it. Postcards use the same
value for the same meaning.

So nothing about the behaviour is broken. What is broken is that the one word
anybody would read off the table is the one claim that is definitely false:
that a book was printed. `failed` already means the *build* failed, so the
vocabulary offers no way to tell "built, never printed" from "built and
printed" — and reading the table without opening `payload.print` gives exactly
the wrong count of physical objects in the world.

## Work

Rename the value to what it means: **`built`**.

- `lib/photobook/orders.ts` — `markPrinted` writes `built`; `markPrintFailed`
  returns to `built`; the three `where("status", "=", "printed")` clauses
  follow. Rename `markPrinted` too: it does not mean what it says either.
- `lib/postcard/orders.ts` — same value, same meaning, same rename. A postcard
  marked `printed` has also only been rendered.
- `lib/adminConsole.ts` — `troubles()` scans this status (B1165); keep the
  query correct under the new name.
- `lib/photobook/print.ts`, `gelato.ts`, `source.ts` — the remaining literals.
- A migration under `lib/db/migrations/` rewriting the stored value for both
  kinds. It is a straight `update print_orders set status='built' where
  status='printed'`; there is no ambiguity to resolve and nothing to lose.
- `failed` keeps its meaning (the build failed) and is untouched.

**Not in this ticket.** No change to when the status is set, to retryability,
to refunds, or to what `troubles()` surfaces. This is one word, everywhere it
is written and read.

**Worth considering while there, and a person's call:** whether a book that
Gelato actually finished should get a *new* terminal status (`printed`, freed
up by this rename, meaning it really was). Today nothing distinguishes a book
the printer completed from one still in flight — the webhook updates
`payload.print` and the status stays put. That is a second ticket if wanted;
do not fold it in.

## Acceptance

- `grep -rn '"printed"' lib app` returns nothing for the order status.
- Every row that said `printed` says `built`, both kinds, after the migration.
- `/admin`'s attention band still lists refused prints (B1165's widening still
  matches).
- A refused print is still retryable.
- `npm run verify` clean.
