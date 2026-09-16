---
id: B1620
title: Three v2 surfaces drop information v1 exposed: day-list test inheritance, status drafts' test flag, and mail send error detail
type: ISSUE
priority: medium
complexity: low
area: API v2
found: "2026-09-12T20:21:13Z"
---

# B1620 — Three v2 surfaces drop information v1 exposed: day-list test inheritance, status drafts' test flag, and mail send error detail

## Why

Found repointing `test/test-content.test.ts` and `test/day-mail.test.ts` off
deleted v1 routes for B1612. Three small, unrelated regressions, bundled
because each is a few lines:

1. **`GET /api/v2/{user}/trips/{trip}/days` does not resolve a day's `test`
   flag from its trip.** `app/api/v2/[user]/trips/[trip]/days/route.ts`
   builds each row from `dayDoc.parse(dayEchoInput(day))` alone — no
   reference to `trip.test` at all. A day with no flag of its own, inside a
   `test: true` trip, reads as ordinary. This is B116's exact bug
   (`docs/tasks/` — the day list not knowing a day inherits `test` from its
   trip), reappeared in the v2-native path. The publish/send routes get this
   right already (`isTestContent(...) || trip.test === true || day.test ===
   true`, checked before every send) — the gap is specifically in what a
   caller is TOLD when they list or read a day, not in what the server will
   do with one. `test/test-content.test.ts`'s "inheriting the flag from the
   trip is NOT resolved here (the B116 bug, back)" documents the current
   behaviour directly.

2. **`GET /api/v2/{user}/status`'s `drafts` rows carry no `test` field at
   all.** `buildJournalStatus` (`lib/api/v2/status.ts`) narrows every draft
   down to `{trip, slug}` before the wire schema even sees it — its own
   comment calls this "a smaller, frozen contract" than v1's `journalStatus`,
   but `title`, `date` and `test` are all gone, not narrowed. This is B134's
   whole property (the review queue says which drafts nobody lived) with no
   surface left to carry it. `test/test-content.test.ts`'s "its drafts list
   carries no test field at all" documents this.

3. **v2's publish/send routes drop the per-recipient error detail a failed
   send has.** `mailSummary`/`whatsappSummary`, reimplemented inline in
   `app/api/v2/[user]/trips/[trip]/days/[slug]/publish/route.ts` and
   `.../send/route.ts` (their own comment: not imported from
   `lib/api/dayMail.ts` because that module sits outside the v2 allowlist),
   report `{attempted, resend, sent, failed}` — dropping the `errors: string[]`
   array `lib/api/dayMail.ts`'s own `mailSummary` still includes when
   `failed.length > 0` (each failure's own message, e.g. "450 4.2.1 mailbox
   temporarily unavailable"). A caller can see THAT a send failed and how
   many, never WHY. `test/day-mail.test.ts`'s "a send that fails for one
   reader does not fail the publish, and is reported" (`expect(mail.errors
   ).toBeDefined()`) is left failing over exactly this, separate from that
   file's bigger B1618 gap (which stops the send from succeeding at all in
   most of that describe block — this one specific test's failure is really
   about the missing `errors` key, not B1618).

## Work

- Add the same `isTestContent(...) || trip.test || day.test` check the
  publish route already makes to the day-list route's per-row mapping (and
  to the single-day `GET`, if it has the same gap — check it).
- Either widen `journalStatus`'s `drafts` row schema to carry `test` (and
  have `buildJournalStatus` pass it through from `listDrafts`) or write down,
  somewhere a person reads before relying on it, that the v2 status endpoint
  is deliberately narrower here — "frozen contract" should be a decision, not
  an accident of not noticing the field was there to keep.
- Either import a shared `mailSummary`/`whatsappSummary` (move
  `lib/api/dayMail.ts` into the v2 allowlist, or duplicate the `errors` line
  into the two inline v2 versions) so a failed send's reason travels as far
  as v1's did.

## Acceptance

- `test/test-content.test.ts`'s "inheriting the flag from the trip is NOT
  resolved here" test is updated to assert the flag IS resolved, and passes.
- `test/test-content.test.ts`'s "its drafts list carries no test field at
  all" test is updated (or removed, if the decision is "frozen on purpose",
  in which case say so in `lib/api/v2/status.ts`'s own comment) to reflect
  the real, chosen shape.
- `test/day-mail.test.ts`'s "a send that fails for one reader..." test's
  `expect(mail.errors).toBeDefined()` line passes.
