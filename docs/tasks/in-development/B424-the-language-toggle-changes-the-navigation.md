---
id: B424
title: The language toggle changes the navigation but leaves the owner's contacts page in the journal's locale
type: ISSUE
priority: low
complexity: low
area: contacts, i18n
found: "2026-09-05T11:58:00Z"
started: "2026-09-05T15:04:59Z"
session: e5747799-fd3e-4d40-a335-82fa4e24333e
claimed: "2026-09-05T15:04:59Z"
---

# B424 — The language toggle changes the navigation but leaves the owner's contacts page in the journal's locale

## Why

Reported by a verification agent working through `/qa-addr-0905/contacts` on
2026-09-05, and being re-checked as this is written.

Switching the header's language control from German to English changed the
navigation labels — Story, Gallery, Map, Trips, Search, Your access — while the
page body under it stayed German: the headings, the hints, the `Postadresse`
line, the form labels. A full reload did not change that.

Two readings, and the ticket exists because nobody has decided which is true:

- **Intended.** The owner's own administrative pages belong to the journal and
  render in its locale, and the reader-facing toggle is about how the *journal*
  is read. Then the defect is only that the toggle appears on a page it does
  not govern, and the fix is to say so or to hide it there.
- **A gap.** The page simply does not thread the chosen locale into the parts
  of itself that are client components, and half of it therefore ignores the
  toggle. Then the fix is to thread it.

Either way, a control that visibly changes half a page is worse than one that
changes all of it or none: it reads as broken, and it makes an owner doubt what
else the toggle failed to reach.

Cost is small and entirely in confidence, which is why this is low.

## Work

Decide which reading is right, and make the page match it. If the admin surface
is deliberately locale-fixed, do not render the toggle there.

Check the sibling admin surfaces at the same time — `/<user>/me` at least — so
the answer is one answer rather than a page-by-page accident.

## Acceptance

On the owner's contacts page, either the whole page follows the language
control or the control is absent, and whichever was chosen is written down
where the next person will find it.

## What changed

Decided: **a gap**, not intended. B469 (found and fixed alongside this
ticket, same root cause) traced it to one line —
`app/[user]/contacts/page.tsx` resolved the page's own chrome as
`pickLocale(user.defaultLocale)`, the journal's default, instead of
`pickLocale(await requestLocale())`, the reader's own choice. That is exactly
why switching the header's toggle moved the navigation (which reads the
locale from `requestLocale()`/the `LocaleProvider` context) but left the
headings, hints and form labels under it in the journal's language — they
were never wired to the toggle at all, on any client/server split. The fix in
B469 makes the whole page read one locale, so the toggle now changes all of
it rather than half.

Checked `/[user]/me` as asked: it already resolves its own chrome from
`requestLocale()` (named `uiLocale`) and was the correct pattern this fix
copies — not a second instance of the bug. It is the sibling surface to point
to when this question comes up again.

## Evidence

Same fix, same evidence as B469: `app/[user]/contacts/page.tsx` now uses
`requestLocale()`; `test/contacts-admin-locale.test.tsx` asserts the page's
own chrome follows a `de` cookie on an English-default journal (fails on the
old code, passes now); `npm run verify` passed in full (build, tsc, eslint,
3128 tests).
