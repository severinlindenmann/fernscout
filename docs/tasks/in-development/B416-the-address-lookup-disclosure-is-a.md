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

## Done

`AddressLookupField.tsx` now takes an `attribution` prop and renders the
listbox and the footer line inside one panel `<div>`; the footer is a `<p
aria-hidden="true">` after the `</ul>`, so it sits outside `role="listbox"`'s
options *and* is marked non-content for a screen reader — belt and braces on
the acceptance line about not announcing it as a result. It appears and
disappears with `showList`, same as the list itself.

`contact.addressLookupHint` is gone from `lib/i18n.ts:89` and all three
locale files; `contact.addressLookupAttribution` replaces it in the same spot
alphabetically, worth "Addresses from OpenStreetMap" / "Adressen von
OpenStreetMap" / "Címek az OpenStreetMap-től". All four call sites
(`ContactForm.tsx`, `ContactsAdmin.tsx`, `InviteRedeem.tsx`,
`ContactManage.tsx`) dropped the standing `<p>` and now pass
`attribution={t("contact.addressLookupAttribution")}`.

The fuller explanation — what the capability does, that a query proxies
through the server to Photon (or whatever `features.addressLookup.url`
names) rather than the browser talking to it directly, and that nothing is
sent below `MIN_QUERY_LEN` characters — is a new subsection in
`docs/running-locally.md`, right after the `SESSION_SECRET` one: no existing
file already documented this capability's behaviour (`grep -rl
"addressLookup" docs/` found nothing before this change), and
`running-locally.md` is where every other capability's behaviour is written
in the same prose-plus-env-vars shape, so this follows that rather than
starting a new doc.

`npm run verify` (build → tsc → eslint → vitest): all four stages passed,
2799 tests passed / 3 skipped (the skipped ones are the Postgres-only tests,
skipped for lack of a local Postgres, unrelated to this change).
`npm run unused`: clean, exit 0 — the only output is the same ~59
pre-existing unused-export warnings (B235) that were there before this
change; nothing new, and no unused files/dependencies.
