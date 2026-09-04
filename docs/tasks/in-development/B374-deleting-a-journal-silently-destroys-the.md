---
id: B374
title: Deleting a journal silently destroys the credits left in it
type: FEATURE
priority: medium
complexity: low
area: credits, deletions
found: "2026-09-04T21:15:00Z"
started: "2026-09-04T21:18:54Z"
session: 3d8b93dd-e447-4c3c-bcd1-fa37e2bd17f9
claimed: "2026-09-04T21:18:54Z"
---

# B374 — Deleting a journal silently destroys the credits left in it

## Why

B366 gives a journal a credit balance that somebody paid money for. `TABLE_NAMES`
in `lib/db/schema.ts` now carries `credits` and `credit_ledger`, and
`lib/deletions.ts` sweeps every table in that list when a journal goes — which
is correct, and is exactly the problem: an owner with 180 unspent credits
presses the delete button and they are gone, with nothing anywhere having said
so.

Deletion here is already built to be the one irreversible thing an agent cannot
finish on its own — `DELETE` answers `202` and mails a link, because "an agent
that reads 'get rid of that test entry' as 'get rid of that journal'" is the
failure it was designed against (B38, `lib/deletions.ts`). The money is a second
thing that does not come back, and the confirmation page is silent about it.

Trips are the smaller half of the same gap: deleting one trip destroys no
credits, and the page should not imply it does.

## Work

Say the number, on the page where the button is —
`app/[user]/delete/[token]/page.tsx`, the journal case only.

- Read the balance with `balanceOf(user)` from `lib/credits.ts`.
- `null` (credits switched off on this server) or `0` → say nothing at all. A
  line reading "you will lose 0 credits" is noise on every self-hosted install,
  and B74's rule applies: absent, not a disabled-looking zero.
- Any positive number → a line in the same register as the rest of that page,
  naming the count, and saying plainly that it is not refunded and does not move
  to another journal.
- Include it in the **confirmation mail** too (`lib/deletions.ts`), not only on
  the page. The mail is where an owner decides whether to follow the link at
  all, and it is the copy that reaches somebody who is deleting a journal they
  are no longer looking at.
- The trip-deletion path says nothing about credits, because deleting a trip
  destroys none. Check this rather than assuming: if the trip sweep touches
  `credit_ledger` rows by `ref` prefix, that is a bug in its own right and a
  separate capture.

Translate the new strings in all three locales (`content/locales/*.json`), like
every other string on that page.

### Not in this ticket

- Refunding, transferring or holding credits over a deletion. The balance dies
  with the journal; this ticket makes that visible, and changing it is a
  business decision nobody has made.
- Blocking or delaying a deletion because credits remain. The owner's decision
  is the owner's; the page's job is that it is an informed one.

## Acceptance

- `npm run verify` green.
- A test in `test/deletions.test.ts` (or a sibling): a journal with a balance of
  180 renders the warning with `180` in it; the same journal at `0`, and the
  same journal with `credits` switched off, render no such line at all.
- The confirmation mail for a journal with a balance names the number.
- By hand: `DELETE /api/v1/<user>` on a journal holding credits, open the
  `.eml`, follow the link, and read the warning before pressing anything.
