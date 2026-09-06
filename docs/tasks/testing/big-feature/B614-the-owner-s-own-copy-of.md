---
id: B614
title: The owner's own copy of a day is charged as if they were a guest, and they cannot be reached on WhatsApp at all
type: FEATURE
priority: medium
complexity: high
area: credits, digest, config
found: "2026-09-06T15:24:06Z"
started: "2026-09-06T15:24:42Z"
merged: "2026-09-06T15:39:33Z"
---

# B614 — The owner's own copy of a day is charged as if they were a guest, and they cannot be reached on WhatsApp at all

## Why

`recipientsFor` in `lib/digest/dayLetter.ts:140` always adds the owner's own
copy of a day letter — "it is their journal and their record that it went" —
and then `sendDayLetter` charges `recipients.length`
(`lib/digest/dayLetter.ts:475`). So the owner pays a credit to be told about
their own day. On a journal with no guests at all that is the *entire* bill,
and `/{user}/me` says so: **"E-Mail · bis zu 1 Person · 1 Guthaben-Punkt"**
over an empty guest list, which reads as a bug and is in fact the honest
price. `optedInCounts` (`lib/contacts/index.ts:692`) exists to make it
honest, and its own doc comment argues at length that leaving the owner out
"understates the price of every mail send by exactly one credit".

That argument is right about the arithmetic and wrong about the price. A
credit is what it costs this instance to reach *somebody else* — a guest, a
traveller. The owner's copy is the journal telling its author what it just
published, and metering that is charging a person to read their own writing.

The same paragraph names the other half. Its WhatsApp counterpart
(`lib/digest/dayWhatsapp.ts:72`) "adds nobody — there is no `owner.tel` and
inventing one would be this codebase deciding somebody's phone number belongs
to it." Correct not to invent one; the consequence is that the owner is the
one person who cannot get the WhatsApp notification, which is also the one
person who would use it to check that the channel works before a guest ever
sees it. `Owner` in `lib/config.ts` is `{ name, nickname, email? }` — there is
nowhere to put a number even by hand.

## Work

**Free, not absent.** The owner keeps their copy on both channels; what
changes is that it is not billed. `free: true` on the recipient, and the
charge counts what is not free.

- `lib/config.ts` — `Owner.tel?: string`, parsed in `parseOwner` and stored
  **normalised to E.164** by `toE164` with no default country code, so a
  number in a config file has to carry its own `+41`. A value that will not
  normalise is a config problem, reported like every other. Env-independent
  on purpose: `whatsappCountryCode()` must not be able to invalidate a file
  that already parsed.
- `lib/digest/dayLetter.ts` — `free: true` on the owner's recipient; `needed`
  counts the non-free ones; the refund does too. Refunding for a recipient
  who was never charged mints credits, so this half is not optional.
- `lib/digest/dayWhatsapp.ts` — when `owner.tel` is set, the owner is a
  recipient, free, and seeded into the `seen` set so a contact sharing that
  number is not messaged twice. Same `needed`/refund treatment. Presence of
  the number is the consent: it is the owner's own journal and their own
  number, and clearing it is how they stop.
- `mailWouldCost` / `whatsappWouldCost` — quote what the charge will take, or
  a `402` disagrees with the debit.
- `lib/contacts/optedInCounts` — drop the `+1`; the owner's address stays as
  an *exclusion* so a contact at the owner's own address, which
  `recipientsFor` folds into the free copy, is not counted either. Same for
  the number on the WhatsApp side, which needs the owner's normalised tel
  passed in.
- `/{user}/me` — the estimate says the owner's own copy is free and guests and
  travellers are not. `me.paymentEmailEstimate` currently says "dich
  eingeschlossen", which becomes false. Three locale files.
- `PATCH /api/v1/<user>/config` — a writable `ownerTel` field, since nothing
  else lets an owner set it and there is no journal-settings UI. It writes
  `owner.tel` inside the owner block, which is the one nested write
  `setJournalProfile` has; `""` removes it. `owner` stays refused as a whole,
  and `JOURNAL_FIELD_REFUSALS.owner` has to stop saying it is never writable.
  `journalProfile` reads it back, `lib/api/openapi.ts` documents it.

**Not doing:** a UI field for the number, and a separate owner opt-out per
channel. The number itself is the switch, and an owner who wants no letters
has `hasSwitchedOff`.

## Acceptance

- A journal with no contacts and an `owner.email` quotes **0** credits for a
  mail send and 0 for WhatsApp, and publishing a day still puts the letter in
  the owner's inbox. `/{user}/me` says the own copy is free.
- One contact opted in to email, plus the owner: quote is 1, debit is 1.
- That contact's address *is* the owner's address: quote is 0, one letter.
- `owner.tel` set, no contacts: publishing sends the owner a WhatsApp message
  and debits 0. A contact sharing that number gets no second message.
- A failed send to the owner refunds nothing; a failed send to a guest
  refunds 1. `test/credits*.test.ts` and the digest tests cover both.
- `owner.tel: "079 123 45 67"` (no country code) fails config parse with a
  message naming the missing `+`.
