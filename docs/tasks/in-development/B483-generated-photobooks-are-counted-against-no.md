---
id: B483
title: Generated photobooks are counted against no quota and never pruned
type: CHORE
priority: medium
complexity: medium
area: photobook, storage, ops
found: "2026-09-05T15:17:20Z"
started: "2026-09-06T14:20:14Z"
session: 6b9bf0a6-5ea8-4f27-bfcd-df5022696053
claimed: "2026-09-06T14:20:14Z"
---

# B483 — Generated photobooks are counted against no quota and never pruned

## Why

Every paid order writes an interior and a cover PDF to
`content/<user>/photobooks/<orderId>/` (`orderDir` in `lib/photobook/build.ts`).
At 300 DPI these are tens to hundreds of megabytes per volume, and a long trip
becomes several volumes.

Nothing bounds them. The `media` block in `content/config.json` — max upload
size, per-day count, optional per-journal byte quota — covers uploads and does
not reach this directory. Nothing prunes it either: an order is kept forever so
its mailed links keep working, which is right, but "forever" is currently
unqualified. The directory is gitignored, so it grows silently and the first
symptom is a full disk on the VPS.

The owner is also the person paying, so this is not abuse — it is ordinary use
with no ceiling.

## Work

Decide what the policy is before writing code, because the options differ in
what they promise the owner:

- count photobook bytes against the existing per-journal quota, and refuse an
  order that would exceed it — needs a size estimate before the build, which the
  page plan can give;
- keep the files for a fixed window and let the download links expire with them,
  which changes what the receipt mail can promise;
- keep the most recent N orders per journal;
- leave it unbounded and document it as an operator's responsibility.

Whatever is chosen, `/api/health` should be able to say how much space this is
using.

**Not doing:** deleting anything automatically without the owner being told what
the rule is.

## Acceptance

- A stated, documented policy, and `docs/providers/photobook.md` says what it is.
- An instance that reaches the limit refuses or prunes deliberately rather than
  filling its disk.

## Resolution

**Policy chosen: keep the newest N *printed* orders per journal, prune the
rest's PDFs.** Reuses the existing `media` block's ceiling/narrow pattern
(`lib/mediaLimits.ts`, the same shape `perUserBytes` already has) rather than
building a second quota mechanism — a new field,
`media.photobookOrdersPerUser`, server-ceiling-then-user-narrowed like every
other field there, shipped with a default of **20** (unlike `perUserBytes`,
which defaults to unbounded: an unbounded photobook directory is the bug this
closes, and 20 is generous for how often anyone actually orders a book).
`null` opts a journal out entirely.

Rejected: byte-quota-against-upload-quota (needs a pre-build size estimate,
more moving parts for the same outcome) and a fixed time window (changes what
the receipt mail can promise, which count-based retention does not).

**Enforcement:** `lib/photobook/retention.ts`'s `pruneOldPhotobooks(owner)`
runs once, right after an order is marked `printed`
(`app/[user]/photobook/order/route.ts`) — never before or during a build. It
only ever considers `print_orders` rows already `status = 'printed'`
(`listPrintedOrderIds`, `lib/photobook/orders.ts`), so a build still
`submitted` is structurally never a candidate and can never race a prune.
Past the kept count it deletes only the order's directory under
`content/<user>/photobooks/<orderId>/` — never the row, never the trip's own
photographs — and records `payload.pruned: true` / `payload.files: []`
(`clearPrunedFiles`) so a page rendering an old order stops offering a
download that would 404. The existing download route
(`app/[user]/photobooks/[id]/[file]/route.ts`) already answered 404 for a
missing file, so it needed no change.

**Where the number is documented before a caller hits it:** `/api/health`'s
new `photobook.keepOrdersPerUser` field (`app/api/health/route.ts`,
`lib/api/openapi.ts`), and `docs/providers/photobook.md`'s new "Retention"
section. `AGENTS.md`'s description of the `media` block was extended by one
clause rather than left silently out of date.

**Test:** `test/photobook-retention.test.ts` — fails before this change (the
functions it imports do not exist) and passes after. Covers: pruning down to
the narrowed count, an in-flight (`submitted`) order never touched however old
its `created_at`, and `null` opting a journal out entirely.
`test/media-limits.test.ts` gained coverage of the new field's default and its
explicit-null opt-out, alongside the existing `perUserBytes` coverage it
already had.

**Not done, on purpose (unchanged from the ticket):** no owner mail when an
old order's files are pruned — the rule is documented publicly rather than
announced per deletion. `docs/providers/photobook.md` says so and names
`pruneOldPhotobooks()` as where to add it if that judgment is wrong.
`npm run verify` (full) is green.
