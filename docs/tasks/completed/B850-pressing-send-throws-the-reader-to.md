---
id: B850
title: Pressing Send throws the reader to the top of the page, where the heading describes a different order
type: ISSUE
priority: medium
complexity: low
area: postcards
found: "2026-09-07T16:52:04Z"
merged: "2026-09-07T17:05:01Z"
completed: "2026-09-09T16:47:39Z"
---

# B850 — Pressing Send throws the reader to the top of the page, where the heading describes a different order

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

Reported from a real send. The Send button is at the bottom of a long page —
photograph, message, recipients, cost — and pressing it navigates, so the
reader lands at the top of the fresh render. What greets them there is the
heading, and the heading is about the *order*, not about what just happened:
the reader has to scroll the whole page back down to find out whether the thing
they pressed worked.

Worse, in the case observed the reader had two orders on the go and read the
top of the wrong one: "Postkarten, bereit zum Senden — Vom Tag Heimflug" over a
line promising nothing had been printed or charged, immediately after pressing
send on a different day's card. Nothing was wrong with either page; the
scroll position and the two similar headings did the rest.

The result banner is already rendered near the top (`data-testid="send-result"`,
`app/[user]/postcards/[id]/page.tsx`), so the information is present. What is
missing is that the reader is not looking at it and has no reason to think they
should be.

## Work

Land the reader on the answer rather than at the top. Options in order of
laziness:

1. Redirect to `#send-result` (or the send section's own id) so the browser
   scrolls there, and give the banner `scroll-margin-top`. One line in the send
   route's redirect and one CSS property.
2. If that reads badly on a phone, move the outcome banner to where the button
   was.

**Not doing:** a client-side send. The button is a form post to an owner-cookie
route on purpose (B434), and it stays one.

## Acceptance

- After pressing Send, the first thing on screen says what happened to *this*
  order.
- Checked at 390px, where the page is longest and the problem worst.
- The banner still carries `role="status"` so it is announced, not merely
  scrolled to.
