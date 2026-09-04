---
id: B390
title: The dialling-code picker is eleven bare numbers with no country, no search and no way to find your own
type: FEATURE
priority: medium
complexity: low
area: contacts, i18n
found: "2026-09-05T00:30:00Z"
started: "2026-09-04T22:19:01Z"
session: 39691533-1e0d-44dd-a2e5-b2a7ce844518
claimed: "2026-09-04T22:19:01Z"
---

# B390 — The dialling-code picker is eleven bare numbers with no country, no search and no way to find your own

## Why

B385 shipped the country selector, and on the live site it is a `<select>` of
eleven entries reading `+41`, `+49`, `+43`, `+33` … — `DIAL_CODES` in
`components/TelField.tsx`. Three things are wrong with it, and they compound:

- **No country is named.** `+39` is Italy to somebody who already knows it is
  Italy. The person filling in this field is often the one who does not.
- **No search.** Eleven is scrollable; a list long enough to hold everybody is
  not, and native type-ahead over a label that begins with `+` matches nothing
  a person would think to type.
- **Eleven countries.** Anybody outside western Europe and North America has
  no entry at all, and the field then stores a national number — which is
  exactly the failure B385 existed to end (`lib/whatsapp/phone.ts:42` refuses
  it and the contact is silently skipped at send time).

The third is the one that costs something. The other two are why the third
cannot simply be fixed by lengthening the array.

## Work

Replace the bare `<select>` with a small searchable combobox inside
`TelField.tsx`: a text box that filters, a list showing flag, country name and
dial code, arrow keys and Enter, Escape to close. No dependency — this is
about a hundred lines and a country picker is not worth a package.

Every country, not a curated eleven. The data table is **iso2 + dial code
only**:

- **Names come from `Intl.DisplayNames(locale, { type: "region" })`** — the
  platform already holds every country's name in every locale this journal
  speaks, so translating 240 names by hand into en/de/hu would be work done
  worse than the runtime does it for free. Fall back to the iso2 code if the
  runtime has no name.
- **Flags are derived from the iso2 letters** by mapping each to its regional
  indicator codepoint (two lines, no assets, no image requests).

Search matches the country name, the iso2 code and the dial digits, so `swi`,
`CH` and `41` all find Switzerland.

Storage is unchanged: still one `PostalAddress.tel` string as `+<cc>
<national>`, read by `toE164`'s existing `+` branch. `splitTel`/`joinTel` do
not change. Several countries share a dial code (`+1`, `+7`), so the *stored*
value still cannot say which — that is fine and must stay fine; the picker
selects a code, not a country.

Not doing: libphonenumber, or per-country number validation. `phone.ts:26`
argues that case and it still holds.

Accessibility is not the corner to cut here: the control needs a label, the
listbox needs roles, and it must be operable from the keyboard alone.

## Acceptance

In all four forms (public guestbook, owner's guest form, invite redemption,
guest self-manage) the picker lists every country with its flag and translated
name, filters as you type, and is usable with the keyboard alone. Picking
Switzerland and typing `765613150` still stores `+41 765613150` and
`toE164` still returns `41765613150`. A test covers the filter matching by
name, by iso2 and by digits, and the flag derivation for a known code.
