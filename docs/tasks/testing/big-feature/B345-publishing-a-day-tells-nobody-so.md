---
id: B345
title: Publishing a day tells nobody, so an owner announces their own journal by hand
type: FEATURE
priority: high
complexity: high
area: mail, publishing, contacts
found: "2026-09-04T19:50:03Z"
started: "2026-09-04T19:53:33Z"
merged: "2026-09-04T20:23:42Z"
---

# B345 — Publishing a day tells nobody, so an owner announces their own journal by hand

## Why

Asked for by the owner on 2026-09-04: when a day is published, everybody who
may read it — guests, the people on the trip, and the owner — should get a
letter carrying that day. Its title, its words, its photograph, where the
traveller was, the local time, what the day cost, and a map link.

Today publishing is silent. `lib/digest/` mails a periodic summary, so a reader
learns about a new day on the digest's schedule rather than when it goes up,
and an owner who wants to *announce* a particular day has no way to.

Two triggers were asked for and both are explicit: `send_mail: true` on the
publish call, and a separate call to send the letter for a day already
published, so one can be sent again.

## The plan

**`docs/plans/2026-09-04-day-published-mail.md`** — written before the work and
kept as the record, per `docs/README.md`. Read it first; it carries the
reasoning this ticket only summarises, and it is where the constraints were
worked out.

The three findings that shape the whole thing:

1. **This is not a new mail system.** `lib/digest/` already resolves
   recipients, filters by what each may read, picks each reader's language,
   records sends, and puts an unsubscribe link in every letter. This is a
   second *trigger* on that machinery with a richer single-day payload.
   Anything that duplicates `lib/digest/` is the wrong answer.
2. **The photograph cannot be a link.** `app/[user]/media/[...path]/route.ts`
   gates every image on `mayReadTrip(trip)`, and a mail client carries no
   session cookie — so an `<img>` is a 404 in the inbox for every `guest` and
   `private` trip, which is most of them. Attach it inline (`cid:`) or send no
   image.
3. **Costs are gated per reader.** `mayViewCosts`/`costsVisibility` already
   decide who sees a trip's numbers. The letter must ask per recipient, not
   once — spend in an inbox is permanent and forwardable.

## Work

Follow the plan. Its section order is the build order, and the three filters
under "Who receives it" are the ones that can hurt somebody: a `private` trip's
day goes only to the people on that trip, `wants_email_digest` is an opt-in
that this must respect, and a `test: true` day sends nothing at all.

`send_mail` must not default to true. Publishing is already the irreversible
step; an agent publishing fifteen days would otherwise send fifteen letters to
everybody the owner knows. Both triggers are owner-only — a trip-scoped token
cannot publish (B28) and must not be able to mail the readership either.

Mail is best-effort throughout. B272 was a production failure where an
unguarded send turned a successful confirmation into "that code didn't work"; a
letter that fails must not fail the publish, and the failure must be visible in
the response rather than only in a log.

## Decided by the owner, 2026-09-04

The plan ends with four questions. All four are answered; the plan itself stays
as written, because it is the record of what was intended before the work.

1. **One switch, not two.** `wants_email_digest` covers both the digest and the
   day-letter. A reader who turned mail off gets neither — so the existing
   opt-in is the only check, and no column, no migration and no new question on
   the redeem form.
2. **Send the journal's own timezone as information, and no clock.** No
   lat/lng timezone lookup, which this project has no data for. Say the
   journal's timezone plainly — `journalTimezone()` in `lib/digest/quiet.ts`
   already resolves it — and let a reader do the arithmetic if they care. This
   sidesteps the trap in the plan: a day published three weeks late would
   otherwise carry a confidently wrong "it is 9pm there".
3. **One photograph.** The first of the day's gallery, attached inline. No
   gallery, no second image.
4. **A resend goes to everybody again.** It is a manual, deliberate act by the
   owner, and its whole purpose is to send the letter a second time — so it
   does not consult what was sent before. The response must say it is a resend
   and how many letters went, because the owner is the only safeguard against
   doing it twice.

**And it must be testable for real.** The owner asked for test letters to
`lindenmann@severin.io`. Build so that a real send can be exercised against the
running instance, not only against `.eml` files on disk — the last two mail
features (B272's failure, B319's letters) were both only proved in tests until
somebody sent one.

## What was open, before those answers

The plan ends with these and they change what gets built:

1. Is a day-letter separately switchable from the digest, or does
   `wants_email_digest` cover both?
2. Local time — which needs a timezone lookup this project does not have — or
   local date only, which needs none?
3. One photograph, none, or the first three?
4. Does a resend go to everybody, or only to those who did not get it?

## Acceptance

- Publishing with `send_mail: true` sends one letter per entitled reader, in
  their own language, and the response says how many went.
- Publishing without it sends nothing.
- A reader who may not see the trip, or may not see its costs, receives
  nothing they should not — asserted by a test per case.
- A `test: true` day sends nothing.
- The photograph arrives in the inbox rather than as a broken image.
- A failed send does not fail the publish, and is reported.
- `npm run build`, `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`.
