---
id: B1143
title: Making a trip public from the day panel is the same single press as fixing a typo
type: FEATURE
priority: low
complexity: low
area: day page, owner tools, visibility
found: "2026-09-09T18:37:00Z"
superseded: "B1585 — the author decided every level gets a second press, always"
---

# B1143 — Making a trip public from the day panel is the same single press as fixing a typo

## Why

**Closed 2026-09-12, superseded by B1585.** The author was asked directly and
answered the open question this ticket holds: every visibility control, at
every level, takes a second press — not only the widening ones. That is written
into B1585's Work section, which rebuilds the day panel's trip select as part
of one shared control. Nothing below is wrong; it is simply decided elsewhere.

B980 round 3 put the trip's own `visibility` and `listed` into the edit panel on
the day, and both are sent by `save()` alongside the title and the prose. So one
press of Save can correct a comma, and can also move a trip from `private` to
`public` — from *the people who were there* to *everyone* — with no separate
confirmation and nothing naming the consequence.

The session that built it flagged this rather than deciding it, which is why
this is a capture and not a defect. The argument for leaving it is real: the
day's own per-update `visibility` already works this way, and Save being the one
deliberate press is a consistent story.

The argument against is that the two are not the same size. A day's visibility
narrows or widens **one update inside a trip whose gate still holds**; the
trip's visibility is the gate. Publishing is deliberately two calls in this
codebase — `POST .../publish` exists as a separate press precisely so there is a
moment in between (B28, and round 3's own take-down button follows it) — and
widening a trip to `public` is the same kind of irreversible-in-practice
disclosure: whoever reads it has read it.

Nothing is broken. This is about whether one of the two fields in that panel
deserves a second press.

## Work

Decide first, build second — this may well be a `wontDo`, and that is a person's
word.

If it is worth doing, the cheapest shape that matches what is already here:

- Only when the change **widens** — `private` or `guest` becoming `public`, or
  `listed` going true. Narrowing needs nothing; a person making a trip more
  private should never be slowed down.
- `components/ConfirmPanel.tsx`, the way round 3's take-down button already
  does, saying what the change means in words a reader would recognise
  ("everyone, including people you have not invited") rather than the field
  name.
- Nothing new server-side. `patchTripVisibility` already refuses `listed: true`
  on a trip no visibility advertises, and that stays the real guard — this is
  about the moment before the call, not the call.

Not doing: a confirmation on the day's own per-update visibility, or on
narrowing anything. Both would be friction with nothing behind it.

## Acceptance

Change a trip from `private` to `public` in the panel and Save asks once, in a
panel, naming who will be able to read it — never a `window.confirm`
(B633/B668). Change it from `public` to `guest`, or edit only the title, and
Save behaves exactly as it does today with no extra press. `npm run verify`
green.
