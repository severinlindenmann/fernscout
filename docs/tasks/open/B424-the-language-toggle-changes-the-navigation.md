---
id: B424
title: The language toggle changes the navigation but leaves the owner's contacts page in the journal's locale
type: ISSUE
priority: low
complexity: low
area: contacts, i18n
found: "2026-09-05T11:58:00Z"
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
