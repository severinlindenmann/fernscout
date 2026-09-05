---
id: B483
title: Generated photobooks are counted against no quota and never pruned
type: CHORE
priority: medium
complexity: medium
area: photobook, storage, ops
found: "2026-09-05T15:17:20Z"
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
