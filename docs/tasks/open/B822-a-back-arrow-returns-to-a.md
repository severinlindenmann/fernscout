---
id: B822
title: A back arrow returns to a fixed parent rather than where the reader actually came from
type: ISSUE
priority: medium
complexity: medium
area: navigation, ux
found: "2026-09-07T17:40:00Z"
---

# B822 — A back arrow returns to a fixed parent rather than where the reader actually came from

## Why

Asked for: *"there are a few go-back arrows on the page — make sure it goes
back to the previous page and not just the main page."*

There are several, and each points at a fixed destination rather than at
history: `components/BackToJournal.tsx`, the arrow in
`components/PageHeader.tsx`, `app/agent/layout.tsx`, `app/docs/layout.tsx`,
and the photobook views. Follow three links inward and the arrow still sends
you to the top, so getting back to where you were means pressing it repeatedly
or using the browser's own control.

## Why this is not simply `router.back()`

That is the obvious fix and it is wrong on its own, which is the reason this
is a `medium` and not a one-liner:

- **Most readers here arrive deep.** The whole product is built around a link
  in an email to one day. For them there is no previous page inside the site,
  and `history.back()` leaves the site entirely — usually back to the mail
  client. That is worse than going to the journal home.
- **`BackToJournal` exists precisely for readers with no history**, and its
  comment says so: the trip gate and the invite form are dead ends reached
  from outside, and a fixed link was the fix.
- A back control whose destination cannot be predicted before pressing is also
  hard to label, and these carry words ("Deine Reisetagebücher"), not just an
  arrow.

## Work

The honest shape is *up, unless we know where you came from*:

- Use the in-app history when there is one — a same-origin referrer, or a
  navigation this app made. `next/navigation`'s router gives the tools; a
  small hook shared by all the arrows is better than each deciding.
- Fall back to today's fixed parent when there is not. Nothing regresses for
  the reader who arrived from a mail.
- The label has to stay honest. If the destination is dynamic, the word has to
  be generic ("Zurück") or derived from the actual target — not a promise of
  the journal home while going somewhere else.
- One implementation, used by every arrow listed above. Five components each
  guessing is how they drift.

## Acceptance

- From a day, into the gallery, into a photograph: the arrow retraces those
  steps rather than jumping to the journal home.
- Opening a deep link directly in a fresh tab and pressing back stays on the
  site and lands on the sensible parent.
- The label never says one destination and goes to another.
- Checked at 390px.
