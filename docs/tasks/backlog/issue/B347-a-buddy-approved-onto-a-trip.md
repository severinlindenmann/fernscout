---
id: B347
title: A buddy approved onto a trip is mailed "follow along whenever you like" and never told they can write
type: ISSUE
priority: high
complexity: low
area: mail
found: "2026-09-04T19:57:10Z"
---

# B347 — A buddy approved onto a trip is mailed "follow along whenever you like" and never told they can write

## Why

`content/locales/en.json:89` — `contact.mailApprovedBody` is
`"{title} let you in. Follow along whenever you like."`, and it is the only
mail a newly-approved contact gets, whichever link they came through.

Approving somebody who arrived on a **buddy** link grants write access to a
trip. The mail tells them they may read. Nothing in it says they can add days,
and nothing points at `/<user>/me`, which is where the whole thing lives — a
complete, correctly trip-scoped agent prompt that B320 built and that this
person now has no reason to ever look at.

Observed 2026-09-04 on fernscout.ch: a buddy approved onto `balkans-2026`
received exactly that sentence and no other. The site half of B320 is good;
this is the half that tells nobody it exists.

## Work

Give the approval mail a buddy variant: say which trip they can write to, and
link `/<user>/me` as the place that hands their agent the instructions. The
approving code already knows the kind and the trip — `lib/contacts/mail.ts`
sends this, and the contacts page renders "A link for someone to write · the
trip X" from the same rows.

The guest wording stays exactly as it is. Do not add the agent prompt itself to
the mail; the point is to send them to the page that has it.

## Acceptance

Approve a contact who arrived on a buddy link. Their mail names the trip and
links `/<user>/me`. Approve one who arrived on a guest link: the mail is
unchanged.
