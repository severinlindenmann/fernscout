---
id: B383
title: The owner's address book loses the postal address when postcards are off
type: ISSUE
priority: medium
complexity: low
area: contacts, capabilities
found: "2026-09-04T21:57:23Z"
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

Split the two gates in `GuestForm`: keep the postcard *consent* checkbox behind
`postcardsEnabled`, show the address fieldset regardless. The hint copy
(`contact.adminAddressHint`) may need a variant that does not promise a card.

Not doing: anything to `ContactForm.tsx`. The public form's gate is correct as
it stands.

Check `updateContactByOwner` / `isPostable` are happy with an address on a row
whose `wantsPostcard` is false — the route comments say they are, confirm it.

## Acceptance

With `postcards` disabled, the owner's "Add a guest" form has the address
fields, saving stores them, and reopening Edit shows them back. The postcard
checkbox stays hidden. A test renders `GuestForm` with
`postcardsEnabled={false}` and asserts the address inputs are present.
