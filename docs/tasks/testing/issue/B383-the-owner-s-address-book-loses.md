---
id: B383
title: The owner's address book loses the postal address when postcards are off
type: ISSUE
priority: medium
complexity: low
area: contacts, capabilities
found: "2026-09-04T21:57:23Z"
started: "2026-09-04T22:00:20Z"
merged: "2026-09-04T22:09:37Z"
session: 39691533-1e0d-44dd-a2e5-b2a7ce844518
claimed: "2026-09-05T08:53:12Z"
---

# B383 — The owner's address book loses the postal address when postcards are off

## Why

On fernscout.ch the owner adds a guest at `/example/contacts` and there is
nowhere to type a street. The whole address fieldset and the postcard tick are
behind `postcardsEnabled` — `components/ContactsAdmin.tsx:528` and `:616` — and
`/api/health` says `postcards: {"enabled": false}` on this instance, so both are
absent.

That was B360's rule and it is right for the *public* form: a reader must not be
offered a postcard this server cannot post. It is wrong for the owner's own
form, and the route already says so — `app/api/contacts/admin/route.ts:192`:
"the address is passed whether or not a postcard was asked for, unlike the
public form … This is the owner's own address book: a number and a street they
typed in is something they meant to keep, not a consent they granted
themselves." The server keeps taking `address` with postcards off; only the
form stopped offering it.

The read side never got the memo either: the contact card still renders a
"Postcard to" row (blank), so the page shows a field it gives no way to fill.

Cost: an owner cannot record where somebody lives until an operator enables a
print provider, and enabling one later does not recover the addresses nobody
could enter.

## Work

Done. Split the two gates in `GuestForm` (`components/ContactsAdmin.tsx`):
the address fieldset (~line 528) no longer checks `postcardsEnabled` at all;
only the postcard consent checkbox (~line 630) still does. The hint
(`contact.adminAddressHint`) now has a second variant,
`contact.adminAddressHintNoPostcards`, rendered when `postcardsEnabled` is
false — it says the address is "kept on file, whether or not you ever print
a postcard" instead of promising a card. Added to `lib/i18n.ts`'s
`TranslationKey` union and to `content/locales/{en,de,hu}.json`.

The read side got the same fix: the contact card's "Postcard to" row
(`components/ContactsAdmin.tsx`'s `ContactRow`) relabelled to reuse the
existing `contact.address` key ("Postal address") instead of the
postcard-specific `contact.adminPostcardTo`, which is now unused and was
removed from `lib/i18n.ts` and all three locale files — a row showing
someone's street should not be captioned "Postcard to" when no postcard was
ever asked for.

Not done, on purpose: anything to `ContactForm.tsx`. The public form's gate
is correct as it stands and untouched.

Confirmed `updateContactByOwner` / `isPostable`
(`app/api/contacts/admin/route.ts`'s `create` and `update` cases) already
accept and store an address whose `wantsPostcard` is false — nothing there
needed changing, the route was already correct as its own comments said.

Two pre-existing tests encoded the old (buggy) behaviour and needed updating
to match the fix: `test/postcard-capability-forms.test.tsx` had asserted the
owner's address fieldset was *omitted* when postcards was off (now asserts
only the checkbox is), and `test/tel-hint-capabilities.test.tsx` had asserted
the whole owner form said nothing about "postcard" with postcards off — too
broad now that the address hint legitimately still mentions the word; the
assertion was narrowed to the phone hint specifically.

## Acceptance

With `postcards` disabled, the owner's "Add a guest" form has the address
fields, saving stores them, and reopening Edit shows them back. The postcard
checkbox stays hidden. A test renders `GuestForm` with
`postcardsEnabled={false}` and asserts the address inputs are present — see
`test/contact-address-fieldset.test.tsx`, plus the updated assertion in
`test/postcard-capability-forms.test.tsx`. `npm run verify` passes in full
(build → tsc → eslint → vitest, 2779 passed, 3 skipped for no local
Postgres, pre-existing lint warnings only).
