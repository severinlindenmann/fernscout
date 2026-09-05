---
id: B466
title: The send button spends money with no moment to reconsider
type: FEATURE
priority: medium
complexity: low
area: postcards
found: "2026-09-05T17:00:10Z"
---

# B466 — The send button spends money with no moment to reconsider

## Why

One press of "Send 1 postcard for 15 credits" prints and posts a real card and
takes the credits, with nothing in between. Everything else irreversible in
this codebase has a second step — deleting a journal goes to a mailbox, and an
agent's destructive call is refused once and has to be repeated with a code.
This is the only irreversible, money-spending action in the product that
happens on the first click.

The warning line under the button says it cannot be undone, which is a label
rather than a moment. A person scrolling a preview on a phone can hit it
without having read the sentence beneath it.

## Work

- A confirmation step before the send actually posts: what is about to happen
  in plain words — the cards go to the printer today and arrive in a few days,
  it costs N credits, leaving M — and an explicit yes.
- Give the button itself some weight: a pressed/working state so the moment
  reads as consequential and a slow connection does not look like nothing
  happened.
- Keep it working **without JavaScript**. The form-post design was chosen for
  a phone on a bad connection in a hostel (see the send route's docblock), so
  the confirmation must not be a JS-only dialog that leaves the no-JS path
  sending on the first click.
- All copy through the locale files, in all three languages — B461 and B465
  are the reason to say so.

**Not doing:** a second mailed confirmation. The preview page already *is* the
person's own deliberate step; the card costs a few francs and is not
unrecoverable in the way deleting a journal is.

## Acceptance

- A single press no longer sends; the person has to confirm what it costs.
- With JavaScript off, the same two steps still work.
- The confirmation names the cost and the balance it leaves.
