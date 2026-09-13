---
id: B1654
title: ownerTel has no v2 home, so retiring the v1 config route would strand every WhatsApp feature
type: FEATURE
priority: medium
complexity: low
area: API v2
found: "2026-09-13T09:51:53Z"
---

# B1654 — ownerTel has no v2 home, so retiring the v1 config route would strand every WhatsApp feature

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

`owner.tel` is written in exactly three places, and only one of them works
after a journal exists:

- `POST /api/v2/journals` — from the SMS phone-verification session at signup.
- `lib/whatsapp/onboarding.ts` — for a journal created inside a WhatsApp
  conversation.
- `PATCH /api/v1/{user}/config` → `setJournalProfile` (`JOURNAL_PROFILE_FIELDS`,
  `lib/journals.ts`) — **the only post-signup writer there is.**

v2's `journalPatch` (`lib/api/v2/schemas/journal.ts`) has no `ownerTel` key at
all. So B1632's retirement of the v1 `config` route would have removed the
last way to set a phone number on an existing journal, and with it — for any
owner who did not verify a phone at signup — the owner's own WhatsApp copy of
a published day (`lib/digest/dayWhatsapp.ts`), the WhatsApp sign-in button
(`whatsappSignInOffered`), and the `whatsapp` evening-reminder channel
(`lib/api/tripReminder.ts` refuses it outright with no `tel` on file).

**This is an oversight, not a decision.** The journal schema's own header lists
what v2 dropped deliberately at the 2026-09-12 owner review — `features` and
`startLocation`, and only those. `ownerTel` is on neither list; it was simply
never carried across. Same shape as the evening reminder, which D18 has just
finished putting back.

`config` has been kept for now, so nothing is broken today. But it is a v1
route surviving for one field, which is exactly the kind of thing phase 4 is
supposed to be able to delete.

## Work

Give `ownerTel` a v2 home, with a D row.

The design question worth settling first: the journal document already carries
an `owner` block (`nickname`, `email`), and **`email` must not become
writable** — changing it is taking over the journal. So this is not simply
"add `tel` to `owner`". Either the patch admits a narrow `owner.tel` while
leaving the rest server-owned, or the field sits at the top level the way v1's
`ownerTel` did.

Worth deciding at the same time, since it is the same question: whether a
number set this way should carry provenance. v1 stores
`ownerTelProvenMethod` (the WhatsApp onboarding path sets
`"whatsapp-inbound"`), and a number typed in by an agent is a weaker claim
than one proved by a passcode. If provenance matters for what the number may
then be used for, the v2 field has to carry it.

Then `app/api/v1/[user]/config/route.ts` can be retired for real, which is
what B1632 wanted.

## Acceptance

An owner (or their agent) can set a phone number on an existing journal
through a `/api/v2` door, read it back, and switch the WhatsApp reminder
channel on — with no v1 route involved. `docs/v2-migration/06-contract-deltas.md`
carries the D row and says what happened to provenance.
