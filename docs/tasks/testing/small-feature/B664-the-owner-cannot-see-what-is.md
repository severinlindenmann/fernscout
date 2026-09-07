---
id: B664
title: The owner cannot see what is using their storage, or reclaim any of it
type: FEATURE
priority: medium
complexity: medium
area: me-page, storage
found: "2026-09-07T07:39:31Z"
started: "2026-09-07T07:53:47Z"
merged: "2026-09-07T08:10:21Z"
---

# B664 — The owner cannot see what is using their storage, or reclaim any of it

## Why

B661 gave a journal a ceiling, a warning mail and a way to buy more room. What
it did not give is the two things somebody actually does when they are told
they are nearly full: **look at what is taking the space**, and **get some of
it back**.

The `/[user]/me` page shows one line — used of allowed — which is the number
the mail already told them. There is nothing that says *the Alps trip is four
gigabytes and the photobook previews are one*, so the only lever an owner has
is the one that costs money. That is the wrong shape: a journal is usually
full of things nobody wants — half a dozen photobook PDFs generated while
choosing a layout, postcard previews of cards that were sent months ago — and
those should be a button, not a purchase.


## Work

Built as described, with one deliberate narrowing recorded below.

**A Storage card of its own** on `/[user]/me`, not a line inside Payment. Its
own prop (`StoragePanel`) resolved outside the `balance !== null` branch, which
is what makes it appear on an instance with credits off — how full a journal is
has nothing to do with whether this server charges for sends. Only the buy
button depends on that.

It carries the headline figure, a red line past 90%, and a **stacked bar with a
legend**: one row per trip by name, plus the inbox, photobooks, postcards and
everything else, biggest first. Each row's share is of the *allowance*, so the
bar's empty tail is the room that is left. The legend names every row and its
size in words — the colour is decoration and nothing is only available by
looking at one.

**`storageBreakdown()` in `lib/storageQuota.ts`** is where the rows come from,
and `other` is what makes them sum to `journalBytes` exactly. A breakdown that
quietly loses a few megabytes is one nobody can reason from.

**`GET /api/v1/<user>/storage`** answers the same numbers plus `reclaimable`,
so an agent asked "why is this journal full" has an answer without walking
anything. A token may read it; knowing the ceiling is close is what stops an
agent starting a batch it cannot finish.

**Cleanup** is `lib/storageCleanup.ts` and
`GET|POST /api/v1/<user>/storage/cleanup` — `GET` is the plan the confirmation
is built from, `POST` does it. Owner's own session only, and a bearer token is
refused outright, the same line `POST .../storage` draws for spending credits.

What it takes: generated photobook PDFs for orders that reached `printed`, and
dry-run postcard sheets. What survives: every photograph, day and trip, and
every order *record* — a printed book still says it was printed, keeps its
price and its date, and is marked `pruned` through `clearPrunedFiles` so
nothing offers a download that would 404. That is `pruneOldPhotobooks`' own
bookkeeping (B483), pressed by a person instead of by a count. A book still
`submitted` is never touched, which is the same rule and the same reason.

**The narrowing, and it is a departure from the request.** The ask said
cleanup should also remove "other file types uploaded". Staged *photographs*
are not in scope at any setting: they are somebody's uploads rather than
generated output, and sweeping them away on a button press is exactly the
irreversible thing this codebase is careful about. Staged **documents**
(`inbox/files/`) are covered, and only behind a second question — the
confirmation asks about them separately, and only when there are any. A staged
photograph is removed one at a time through
`DELETE /api/v1/<user>/inbox/<id>`, where a person is looking at what they are
removing. If the intent really was "empty the inbox on one press", that is a
one-line change to `runCleanup` and a decision somebody should make on purpose.

**Not doing:** any automatic cleanup, any schedule, any deletion of trip media.

## Acceptance

`test/storage-cleanup.test.ts` (9) and six new cases in
`test/access-panel.test.tsx`. `npm run verify` passes: 313 files, 4095 tests.

- **The breakdown adds up.** "the rows sum to what the ceiling is measured
  against" — against `journalBytes` itself, with `other` non-zero because
  `config.json` is real bytes nobody's trip owns.
- **The card.** "names every row and its size, not only the colours"; "offers
  the cleanup before the purchase" (asserted by position — the free lever
  comes first); "is there with credits off; only the buy button is not";
  "warns past ninety per cent, and not below it"; "with nothing to reclaim,
  says so instead of offering a button".
- **`GET /api/v1/<user>/storage`** returns the same numbers the page renders —
  both read `storageFor` and `storageBreakdown`, and the route is in
  `/openapi.json` with `/storage/cleanup`.
- **Cleanup takes the right things.** "a printed book's PDFs go; its record
  stays, marked" asserts `status: printed`, `pruned: true` and an empty
  `files`. "postcard sheets go".
- **And never the wrong ones.** "photographs, days and trips are untouched";
  "a book still building is never touched"; "staged photographs stay, with or
  without the second answer"; "without the second answer, staged documents
  stay too".
- **The confirmation names the categories and the size** before anything is
  deleted — `me.storageCleanupConfirm` carries both, and the staged documents
  are a second question.

**For whoever verifies this:** open `/<user>/me` as the owner and look at the
bar — the thing a test cannot answer is whether the segments are legible at
390px and whether the trip names are readable when one trip dwarfs the rest.
Then press Free up and check the confirmation says what it will and will not
take before you agree to it.
