---
id: B70
title: A test trip is mailed out in the digest as if somebody had lived it
type: ISSUE
priority: medium
complexity: low
area: digest, test-flag, push
found: "2026-09-01"
started: "2026-09-01"
merged: "2026-09-01"
session: 62683d95-33a6-4db0-a254-7a8fcbcf014e
claimed: "2026-09-05T08:24:22Z"
superseded: "B387 — the weekly digest was removed; lib/digest/index.ts, visibility.ts, mail.ts and scripts/digest.mts are absent from the deployed tree as of 2026-09-05"
---

# B70 — A test trip is mailed out in the digest as if somebody had lived it

## Why

Found while widening `digestableTrips` for **B52**, and deliberately not fixed
there: it is a different rule being broken.

`test: true` is the one exception to "write only what you were told" — a trip
or a day nobody lived, written to prove the pipeline works. AGENTS.md says what
that costs the rest of the system: it "is kept out of the feed, the search index
and the sitemap". `isIndexable` (`lib/access.ts`) is where that is enforced, and
it is the only place: `visibility === "public" && listed && !trip.test`.

The digest never asks. `digestableTrips` (`lib/digest/visibility.ts`) treats a
trip that is not indexable as one that is merely *not advertised*, and sends it
to any reader holding a live `read` grant. A `test: true` trip is not indexable
for a different reason entirely — it is fiction — and falls into that same
branch. So the family the owner approved are mailed "2 new days in Bellinzona"
about a journey nobody took, with a link, in the channel that reaches everybody
who will never install anything (ROADMAP D2, decision 6).

Two things make it worse than an ordinary missing filter:

- **The mail carries no banner.** The page a test trip renders says in a banner
  that none of it happened, and B47 has just given the markdown twin the same
  warning twice over. `lib/digest/mail.ts` renders a date, a title, a location
  and a link — there is nowhere in that shape for the caveat to appear, so the
  mail is the one surface that can hand out invented content with no label at
  all.
- **B52 widened the reach.** Before it, this needed a `public` trip carrying
  `test: true`. Now a `guest` test trip reaches the same readers, which is
  precisely the setup somebody exercising the pipeline on a live journal will
  reach for.

`lib/push.ts` (`subscribersFor`) draws its own line and does not ask either —
worth checking in the same pass, alongside **B68**, which is the other missing
question in that function.

## Work

- One condition in `digestableTrips`: a trip that `isTestContent` covers is in
  nobody's digest, grant or no grant — the same shape as the `private` line
  directly above it, and for a different reason worth stating in the comment.
  A day carrying its own `test: true` inside a real trip is the harder half:
  `buildDigestContent` (`lib/digest/content.ts`) lists days out of
  `getDays(trip.ref)`, which drops drafts and keeps test days.
- Decide, and write down, whether a test *day* is dropped from the list or the
  mail is suppressed when nothing real is left. Dropping the day is probably
  right — the trip is real, the Tuesday is not — but it changes `dayCount` and
  the cursor, so it needs saying rather than assuming.
- Check `subscribersFor` in `lib/push.ts` for the same gap while there.
- `test/digest.test.ts` has the fixture: a fourth trip carrying `test: true`,
  beside the guest and private ones B52 added.

**Not doing:** a banner or a caveat *inside* the mail. The decision here is that
invented content does not go out by mail at all, which is simpler than making
every channel able to disclaim it.

### The decision the Work section asked for

**A test day is dropped; the mail is not suppressed.** The trip is real and the
reader wants to hear about it — only the Tuesday is invented, so only the
Tuesday goes. Three consequences, all of them deliberate and all of them
asserted:

- It counts toward nothing: not `dayCount`, not the listing.
- **It does not move the cursor.** This is the part that needed saying. A
  watermark that advanced over a day the reader was never told about would
  bury any *real* day written for the same date afterwards. So the cursor stops
  at the last day that happened, and the invented one is skipped again on every
  later run rather than swallowed once.
- A reader whose only new days were test days therefore has `dayCount === 0`,
  which `buildDigestContent` already answers with `null` — no mail, not an
  empty one. The third acceptance line falls out of the first rather than
  needing its own branch.

Filtering happens at the **entry** level, not the day level, because a day may
hold several updates and only some of them invented; the lead becomes the
first update that actually happened.

### What `subscribersFor` turned out to be

The same gap, and worse in one respect: `isOpenToLink` returns *every*
subscription in the journal before any other question is asked, and a trip
written to prove the pipeline is normally `public`. So the test check goes
first, ahead of `isOpenToLink`.

Push also announces one *day*, not a trip — `scripts/notify.mts` resolves an
entry and then asks `subscribersFor(trip)`. So the function now takes an
optional `entry`, and the script passes it: a `test: true` day inside a real
trip notifies nobody either, which is the push twin of the digest half above.
The script says so on the console instead of silently sending to zero people.

The `private` half of that function is **B68**, not this task.

### Captured, not absorbed

**B81** — `scripts/notify.mts` still tells the operator a closed trip is
"password-protected". B39 removed trip passwords; the sentence outlived them.
Wrong words, not a wrong filter, so it is its own task.

## Acceptance

- A `test: true` trip appears in no reader's digest, with a live grant and with
  none — a test that fails against today's code.
- A `test: true` day inside an ordinary trip is not listed either, and the
  reader's watermark does not silently jump past it.
- A reader whose only new days were test days gets no mail, rather than an empty
  one.
- The four checks.

### Where it is asserted

`test/access-gate.test.ts` gained `test: true` as a **second dimension of the
table** rather than a test of its own — one `public` and one `guest` trip
carrying the flag, beside the five visibilities already there, and a `digest`
column beside `panel` and `read`. One table now answers "which surfaces may
mention which trips to whom" for the gate, the panel and the digest; **B68 adds
push as the fourth column.** Extending it was worth more than either fix: the
table is what stops a fifth surface being written that forgets one of the two
dimensions.
