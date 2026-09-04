---
id: B303
title: The phone number field on the guestbook and the admin guest form never says what it is for
type: ISSUE
priority: low
complexity: low
area: contacts, i18n
found: "2026-09-04T14:33:46Z"
related: B274
started: "2026-09-04T16:07:52Z"
merged: "2026-09-04T16:19:29Z"
completed: "2026-09-04T20:01:41Z"
---

# B303 — The phone number field on the guestbook and the admin guest form never says what it is for

## Why

Found while building B273, which added a phone number field to the guest
invite form (`components/InviteRedeem.tsx`) and gave it a hint —
`contact.telHint`, "kept on file for the owner — nothing on this site sends
to it yet" — because a field with no stated purpose on a stranger's site
reads as harvesting (B273's own Work section says so).

The same field already existed in three other places before B273, and none
of them say what it is for: `components/ContactForm.tsx:250` (the guestbook,
`/{user}/i/<token>`), `components/ContactManage.tsx:148` (the reader's own
manage page, `/{user}/c/<token>`), and `components/ContactsAdmin.tsx:420` (the
owner adding or editing a guest by hand). All three render `contact.tel` with
`(contact.optional)` beside it and nothing underneath — the exact gap B273
was filed to close on the invite form.

## Related

Both are contact-facing copy that does not say what a thing is for — the
manage link's label (B274) and the phone field's silence in three components
(B303). One i18n pass over `contact.*` covers them, in all three languages,
and doing them separately means writing the same strings twice.

## Work

Add `{t("contact.telHint")}` under the tel input in the three files above,
the same way `InviteRedeem.tsx` does it now. The key and its three
translations already exist (`content/locales/{en,de,hu}.json`) — B273 added
them — so this is only wiring, not new copy, except that `ContactsAdmin.tsx`'s
form is the owner typing about somebody else and may want a differently
worded key (`contact.adminAddressHint` already has that split for the
address fieldset's hint; consider `contact.adminTelHint` for parity, or
decide the existing wording reads fine either way and reuse it).

## Acceptance

- Every place `contact.tel` is rendered as a form field also renders a hint
  saying what it is for, in a screenshot or a rendered-HTML test.
- `npm run build`, `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`.

## Decision: `contact.adminTelHint`

Added it, for parity with `adminAddressHint`. Reasoning: `contact.telHint`
reads "kept on file **for the owner** — nothing on this site sends to it
yet" — correct when a reader is entering their own number (the hint explains
who the number is for), but odd once the *owner* is the one typing it into
`ContactsAdmin.tsx`'s `GuestForm`: "kept on file for the owner" said by the
owner, about a number they are entering themselves, reads like a form
talking about a third party that isn't there. Dropped the redundant "for the
owner" clause for the admin string: en now reads "kept on file — nothing on
this site sends to it yet".

Checked the German and Hungarian `telHint` translations before touching
them: neither one actually contains a literal "for the owner" clause to
begin with (de: "wird nur gespeichert — bisher wird von hier aus nichts
dorthin geschickt"; hu: "csak eltároljuk – egyelőre semmi nem küld ide
semmit") — the translators already wrote it in the neutral form English
alone needed adjusting to. So `adminTelHint` reuses the existing de/hu
`telHint` strings verbatim; only English got new copy. All three languages
still have their own `contact.adminTelHint` key (no cross-locale fallback),
so the wiring stays uniform across `ContactForm.tsx` / `ContactManage.tsx`
(both use `contact.telHint`) and `ContactsAdmin.tsx` (uses
`contact.adminTelHint`).

## Work done

- `components/ContactForm.tsx:250` (guestbook) — added
  `<p className="mt-2 text-base text-navy-600">{t("contact.telHint")}</p>`
  under the tel input, same pattern as `InviteRedeem.tsx`.
- `components/ContactManage.tsx:148` (reader's own manage page) — same hint,
  same key, same pattern.
- `components/ContactsAdmin.tsx:420` (`GuestForm`, the owner's add/edit
  form) — added the hint using the new `contact.adminTelHint` key (decision
  above). `GuestForm` was also exported (it was previously private to the
  module) so a test could render it directly — its open/closed state
  (`formTarget`) is client-side `useState` with no prop to seed it open, and
  this suite runs with `environment: "node"` (no DOM, no
  `@testing-library/react`), so a click-driven test wasn't available without
  adding a new devDependency, which felt out of scope for a wiring ticket.
- `content/locales/{en,de,hu}.json` — added `contact.adminTelHint` to all
  three (alphabetically, between `adminSubtitle` and `adminTitle`).
- `lib/i18n.ts` — regenerated via `npm run i18n:keys` so `TranslationKey`
  includes the new key.
- `test/contact-tel-hint.test.tsx` — new test, one case per component,
  proving each place that renders `contact.tel` as a form field also renders
  a hint underneath it (`renderToStaticMarkup`, matched against the
  dictionary string, not just a literal grep of the diff).

## Evidence

`grep -rn 'contact.tel' components/` — every hit is either a rendered form
field followed by its hint, or the one read-only `<dt>{t("contact.tel")}</dt>`
display in `ContactsAdmin.tsx:191` (inside the approved-contact `<dl>`, not a
form field, so out of scope):

```
components/ContactsAdmin.tsx:191:            <dt>{t("contact.tel")}</dt>
components/ContactsAdmin.tsx:421:          {`${t("contact.tel")} (${t("contact.optional")})`}
components/ContactForm.tsx:250,251,254,261
components/InviteRedeem.tsx:291,301
components/ContactManage.tsx:159,169
```

`npx vitest run test/contact-tel-hint.test.tsx` — 3 passed (1 per component).

`npm run verify` — build → tsc → eslint → vitest, all four green:
`Test Files 170 passed (170)`, `Tests 2478 passed | 3 skipped (2481)`,
`all 4 passed in 98s`. The 4 eslint warnings printed are pre-existing and
unrelated (`Locale`/`translate`/`createElement` unused, in files this task
did not touch).

No second, separate problem found; nothing captured to backlog beyond the
existing `related: B274`, which stays untouched and unapproved per scope.
