---
id: B509
title: A photobook order charges before it builds, so an interrupted build takes the money
type: ISSUE
priority: high
complexity: medium
area: photobook, credits, reliability
found: "2026-09-05T18:57:29Z"
started: "2026-09-05T18:58:35Z"
session: d9c396ea-a80a-4f80-954a-d37a0bf2c8c8
claimed: "2026-09-05T18:58:35Z"
---

# B509 — A photobook order charges before it builds, so an interrupted build takes the money

## Why

Two photobook orders on fernscout.ch charged the owner and delivered nothing.

```
2026-09-05T15:39:03Z  -154  photobook  acb14851-…
2026-09-05T17:02:46Z  -203  photobook  f3e5ab32-…
```

Both refs are real order ids. Neither has a row in `print_orders`, neither
wrote a file to `content/example/photobooks/`, neither sent a receipt, and
neither was refunded. 357 credits — about CHF 71 at the base tier — for
nothing. Refunded by hand on 2026-09-05; the defect is not.

`pg_stat_user_tables` says `print_orders` has had 8 inserts and 8 deletes and
is now empty, so the rows were written and later removed. Nothing in the
codebase deletes from that table — `deleteJournal` does, by owner, but
`content/.deleted/` is empty so no journal was deleted. **The mechanism for
the missing rows is not established.** That is worth saying plainly rather
than guessing, and it is the first thing to find out.

What *is* established is the shape of the exposure, and it is
`lib/photobook/build.ts`'s own accepted ceiling:

> ponytail: renders synchronously, in the request that pays. A 160-page book
> is tens of seconds and hundreds of megabytes of JPEG copying.

The order route spends, then builds, in one request. Between those two points
there is no durable record that money was taken for work not yet done —
`markFailed` and `refund` only run if the process survives to run them. The
service was being restarted repeatedly by deploys in the window both charges
fall in, and a `SIGKILL` mid-build loses the money, the files, the receipt and
the refund together, leaving exactly what was found. Plausible, not proven.

The same hole is open for a proxy timeout, an OOM, or a browser that gives up —
anything that ends the request between `spend` and `markPrinted`.

## Work

Find the missing rows first: if something is deleting `print_orders`, that is a
second bug and every conclusion below rests on knowing which.

Then close the window. The options, in increasing order of honesty:

- **Refund on boot.** A row left `submitted` with no files is an interrupted
  order; sweep them at startup, refund, mark failed. Cheap, and it fixes the
  crash case without changing the flow. Requires the row to survive, which is
  exactly what did not happen here.
- **Build first, charge second.** The book exists before any money moves. Costs
  a wasted build when the balance is short — which the page already knows
  before Pay is pressed, so it would be rare.
- **Take the work out of the request.** The upgrade `build.ts` already names:
  respond immediately, build in a job, mail when done. The receipt already
  carries links rather than the PDF, so nothing else changes. This is the real
  answer and the largest.

Refuse a deploy that would restart the service mid-order, or accept that it
can, and make the sweep good enough that it does not matter.

**Not doing:** leaving the synchronous build in place with only a comment
about it. The comment was right that a job queue is a subsystem; it was wrong
that one person pressing one button a few times a year is safe. Twice in one
afternoon.

## Acceptance

- An order interrupted at any point after `spend` either delivers a book or
  returns the credits, without a person noticing and doing it by hand.
- A test that kills the build between spend and mark, and asserts the balance
  comes back.
- The reason the `print_orders` rows disappeared is written down.
