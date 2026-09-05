---
id: B416
title: The address-lookup disclosure is a paragraph under every street field, before there is anything to disclose
type: FEATURE
priority: low
complexity: low
area: contacts, address lookup, brand
found: "2026-09-05T10:35:00Z"
started: "2026-09-05T08:31:10Z"
session: 39691533-1e0d-44dd-a2e5-b2a7ce844518
claimed: "2026-09-05T08:31:10Z"
---

# B416 — The address-lookup disclosure is a paragraph under every street field, before there is anything to disclose

## Why

B399 put a standing line under the street field in all four contact forms:

> Suggestions come from Photon, an OpenStreetMap-based service — nothing is
> sent until you start typing here.

`contact.addressLookupHint`, rendered at `ContactForm.tsx:358`,
`ContactsAdmin.tsx:677`, `InviteRedeem.tsx:438`, `ContactManage.tsx:255`.

It is two claims at once — where the data comes from, and when a request is
made — and it is shown at the one moment neither is true yet. A person filling
in an address block already carries a phone hint, an address hint and two
consent checkboxes; a third paragraph of explanation is the one that turns a
form into a wall of small grey text, and it is the least useful of them
because nothing has happened yet.

The disclosure itself is not the problem and must not simply be deleted. Two
separate reasons it has to appear somewhere:

- **Attribution.** OpenStreetMap data is ODbL, and displaying results from it
  carries an attribution obligation. That obligation attaches to *showing the
  results*, which is precisely where the sentence currently is not.
- **Honesty about the request.** Somebody typing a family member's home
  address is entitled to know it is being looked up elsewhere. B399 argued
  that and the argument holds.

Both land better in the same place: attached to the suggestion list, which is
the moment the query has actually been made and the results are on screen.

## Work

Move it into the listbox as a footer row — one short line, muted, below the
suggestions, e.g. "Addresses from OpenStreetMap". It appears the instant there
is something to attribute and disappears with the list.

Delete `contact.addressLookupHint` and its four call sites. Add the new key in
en/de/hu. Nothing above the field, nothing when the list is closed.

Keep the fuller explanation of what the capability does, and that queries
leave the server, in prose somebody can find — the journal's own docs rather
than the form.

Not doing: an "I agree" step, or holding the first query until somebody
confirms. The lookup only ever sees what a person deliberately typed into a
street box, and a consent gate in front of a text field is the kind of
friction that teaches people to click past gates.

## Acceptance

With the capability on, the street field carries no explanatory paragraph. As
soon as suggestions appear, the list ends with the attribution line, and it
goes when the list closes. `contact.addressLookupHint` no longer exists in
`lib/i18n.ts` or any locale file, and `npm run unused` stays clean.
