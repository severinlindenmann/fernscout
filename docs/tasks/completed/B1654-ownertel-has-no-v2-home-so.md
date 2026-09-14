---
id: B1654
title: ownerTel has no v2 home, so retiring the v1 config route would strand every WhatsApp feature
type: FEATURE
priority: medium
complexity: low
area: API v2
found: "2026-09-13T09:51:53Z"
merged: "2026-09-13T14:28:09Z"
completed: "2026-09-14T16:32:30Z"
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


## Decided 2026-09-13 — where each detail lives, and why they differ

The owner asked for these to be centrally managed the way guest and buddy
details are — a row in the database rather than a field in `config.json` — and
left the call to me. **The two details split, and the reason is worth keeping.**

**`owner.email` stays in `config.json`.** It is not contact information. It is
the journal's own statement of who owns it: `lib/contacts/session.ts` reads it
on every request, and a journal with none "has no owner, and therefore no admin
surface". Three consequences follow, and each one is a reason not to move it:

- **A database drop must not orphan a journal.** M1 dropped this instance's
  database on purpose and will not be the last time. Every journal whose
  ownership lived only in a dropped table would be unclaimable — nobody could
  sign in, including the operator.
- **An export has to be complete.** `npm run export` hands somebody their whole
  journal back, and self-hosting it later is the documented way out. A folder
  that does not say whose it is has lost the one fact that makes it theirs.
- **A restore from content alone has to work.** Today it does. That property is
  worth more than the tidiness of one storage location.

A guest's address is genuinely different: it is a *grant*, it is revocable, and
it is meaningless without the database row that carries it. The owner's address
is the opposite — it is the claim everything else is checked against.

**`owner.tel` may move centrally, and that is the part to build.** It is a
notification channel rather than an ownership claim, so it degrades gracefully:
lose it to a database drop and WhatsApp stops until somebody re-proves a
number, which is an inconvenience rather than a lost journal. It also *wants* a
row, because it carries provenance — v1 already stores
`ownerTelProvenMethod`, and a number proved by passcode is a stronger claim
than one an agent typed. Provenance is exactly the kind of fact a table holds
well and a config file holds badly.

So: a central store for the number, alongside contacts; `config.json` keeps the
address. `PATCH /api/v1/{user}/config` survives until that store exists.

Note for whoever builds it: the phone is used **only at signup** today
(`/api/auth/signup/phone`) and for notifications. Nothing signs in to an
existing journal by phone. If that ever changes, the number stops being a
notification channel and this whole decision has to be revisited — a sign-in
route that a database drop can delete is the orphaning problem again.

Self-service editing of either detail is **not** in scope here and is parked as
B1655.
