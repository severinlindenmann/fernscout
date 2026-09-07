---
id: B661
title: A journal has no storage ceiling it can see, reach or raise
type: FEATURE
priority: high
complexity: high
area: media, credits, config, mail
found: "2026-09-07T06:44:28Z"
started: "2026-09-07T07:04:39Z"
merged: "2026-09-07T07:32:13Z"
---

# B661 — A journal has no storage ceiling it can see, reach or raise

## Why

A journal on a shared instance can grow until the VPS disk is full, and
nobody involved finds out until it is. Three separate gaps.

**The ceiling is off, and it only guards one door.** `perUserBytes` in
`lib/mediaLimits.ts` defaults to `null` — no limit — and `site/config.json`
sets no `media` block at all, so fernscout.ch has no ceiling today. Where it
is set, `lib/api/media.ts:274` is the only thing that enforces it, and it
counts only `media/` and the originals of every trip
(`journalMediaBytes`, `lib/api/media.ts:90`). Everything else that lands
under `content/<user>/` is free: photobook PDFs (tens to hundreds of MB each
— B483 prunes them by *count*, not by bytes), generated postcards, and
markdown. What a person pays for is the folder, so the folder is what should
be counted.

**Nobody is told.** There is no mail on the way to full and none on
arriving. The one place the bytes are already counted for a human is the
operator's status mail (`bytes` in `JournalRow`, `lib/statusReport.ts:47`) —
that is the operator, not the owner, and it is a nightly digest rather than a
warning.

**A full journal is a dead end.** The refusal from `lib/api/media.ts` names
the number and offers nothing. On an instance that already has credits and a
purchase flow (`lib/credits/pricing.ts`, `lib/credits.ts` `grant`/`spend`),
the owner has no way to buy the room they have just been refused.

Cost of leaving it: the failure mode is a full disk on the VPS, which takes
down every journal on it, and the first symptom is somebody else's upload
failing.


## Work

Built as described below; where it differs from the capture, the reason is
given.

**A quota over the whole journal folder.** `lib/storageQuota.ts` is the new
module and the only thing that answers "how big is this journal" — one walk of
`content/<username>/`, plus that user's subtree of `MEDIA_ORIGINALS_DIR` where
an instance has moved originals to another disk. It replaces the two walks
that said different things: `journalMediaBytes` in `lib/api/media.ts` (gone)
and `dirBytes` in `lib/statusReport.ts` (now imported from here, so the
operator's nightly mail and the upload gate count the same bytes).

`DEFAULT_MEDIA_LIMITS.perUserBytes` is 5 GB rather than `null`. `null` still
parses, for an instance that would rather take the risk.

**One guard, at the two doors that write real bytes.** `storageRefusal()`
returns the sentence to refuse with, or null. `storeUploads` calls it — so
both the multipart and the by-URL upload paths go through it, since they share
that one function — and `app/[user]/photobook/order/route.ts` calls it before
it claims an order, which is the non-upload door and the one that was writing
hundreds of megabytes past every ceiling. A refused book redirects to a new
`no_room` outcome with its own message in all three languages.

**Markdown writes are deliberately not gated.** A day is kilobytes, and a
journal that could not correct a typo because its photographs had filled the
disk would be held hostage by the thing it is being asked to fix.

**Mail at 90% and at full**, to the address in the journal's own
`config.json`, transactional so an empty balance cannot silence it. Once a day
per journal and level, by `rateLimitFor` — deliberately not a table: the state
is in memory, so a restart lets one more notice through, and the failure mode
is a duplicate mail rather than a silence. Marked `ponytail:` in the source.

**5 GB for 50 credits, and no new table.** `EXTRA_STORAGE_CREDITS = 50` is
CHF 10.00 at the base tier and is already the smallest tier's price, so buying
credits and then buying storage is one purchase of one amount. `POST
/api/v1/<user>/storage` spends through `credits.spend` with a new `storage`
reason; `credit_ledger` is append-only and already the record of every
purchase, so `countSpends(user, "storage") × 5 GB` **is** the extension —
lifetime because nothing exists that could end it, and repeatable because the
rows add up. Purchased bytes are added on top of the narrowed config ceiling,
never instead of it.

**The route refuses a bearer token outright**, the way the postcard send route
does. `isOwner` alone would have let a journal-scoped agent token through; an
agent that has just been refused an upload should report it rather than spend
the owner's credits to get past it.

**One bug found on the way, fixed here** (`lib/config.ts`): a user's media
block was parsed against the *shipped defaults* and only then narrowed against
the instance's, so a field a journal said nothing about arrived as the default
and `narrowest` took the smaller of the two. Invisible while every default was
also the shipped maximum; not invisible once `perUserBytes` had one, since an
operator who had switched the ceiling off entirely still got 5 GB imposed on
every journal. `loadUserConfig` now parses the raw block against the ceiling.

**Not done:** subscriptions or recurring billing — one-off purchases only.
No change to the per-file or per-day limits. Nothing outside the journal
folder is counted: not the database, and not `<dataDir>/mail/`.

Contract: `POST /api/v1/{user}/storage` is in `lib/api/openapi.ts` with its
four refusals, `/status` documents its new `storage` block, `/api/health`
carries `media.perJournalBytes` so a caller reads the ceiling before meeting
it, and `/agent.md` says both that the ceiling exists and that buying past it
is the owner's call and not an agent's.

## Acceptance

Every line demonstrated by `test/storage-quota.test.ts` (13 tests) unless
said otherwise. `npm run verify` passes: 310 files, 4036 tests.

- **Refusal at every byte-writing door.** "every byte under the journal,
  photobooks and markdown included" proves the count is the folder; "a write
  that would go past the ceiling is refused" proves the refusal names the
  total it would reach. The non-media door is asserted at the source level —
  "ordering a photobook asks the same guard uploads do" — in the shape
  `test/postcard-orders.test.ts` already uses, because building a book in a
  test costs tens of seconds and a headless renderer.
- **`/status` reports it, and the contract is honest.**
  `test/openapi-contract.test.ts` and `test/api-route-schemas.test.ts` pass
  with the new route and its documented refusals.
- **One mail per crossing.** "crossing the warning line mails once, not once
  per upload" and "being refused mails too, and only once" — each asserts a
  second attempt writes no second `.eml`.
- **The purchase.** "fifty credits add five gigabytes, and buying twice adds
  twice"; "a balance too small buys nothing and changes no ceiling"; "what was
  refused before the purchase is allowed after it".
- **The server's ceiling still narrows.** "a journal cannot widen its own
  ceiling by asking" — a journal asking for a gigabyte against an instance
  ceiling of 10 000 bytes gets 10 000.
- **Not an agent's to buy.** "a bearer token is refused, and nothing is
  charged".

**For whoever verifies this**, two things a test cannot answer:

1. **A journal already over 5 GB starts refusing uploads the moment this
   deploys.** Check the live instance's sizes (`npm run status`) before
   shipping, and set `media.perUserBytes` in the operator's `FERNSCOUT_CONFIG`
   if any journal is close.
2. Open `/<user>/me` as an owner with credits on: the Payment card should show
   a "Storage" line with used-of-allowed, a red note past 90%, and a button
   that buys 5 GB and redraws the figure.
