---
id: B753
title: Sending a sign-in code gives no sign that anything was sent
type: FEATURE
priority: low
complexity: low
area: auth, ui, motion
found: "2026-09-07T15:32:00Z"
started: "2026-09-07T13:20:25Z"
session: ccdd5120-0eb0-4abf-b76e-a6fd8e5005d8
claimed: "2026-09-07T13:20:25Z"
---

# B753 — Sending a sign-in code gives no sign that anything was sent

## Why

Asked for directly: *"can you add an animation when clicking sending passcode,
maybe like a letter animation going wuush."*

The moment deserves it. Pressing "Send me a code" is the only point in signing
in where something leaves the building and the person then has to go and look
somewhere else — their mail. Today the button swaps to a disabled state and the
form replaces itself with the code field, which happens fast enough that on a
quick connection nothing appears to have occurred at all. Somebody who is not
sure whether they pressed it presses it again, which sends a second code and
invalidates the first.

Motion that answers a person's action, and shows what changed, is the kind
worth having — as opposed to the decorative entrance animations this project
does not use anywhere.

## Work

- An envelope that leaves when the request is sent: a short flight up and away
  with a fade, then the code field arrives. Keep it under ~500ms — this sits
  between a person and their mail, and a long flourish is a delay dressed up.
- Draw it from the palette and the existing vocabulary. There is already an
  airmail motif in this product and a travel scene full of drawn objects
  (`components/Vehicle.tsx` and the benches under `/docs/branding`); a letter
  belongs to that family. Do not import an icon set for it.
- **`prefers-reduced-motion` must skip the flight**, not merely shorten it —
  the state change still has to be legible without it.
- The animation must not gate the outcome: if the request fails, the error
  must still arrive, and the envelope must not still be flying over it.
- It runs on the send, not on mount, and not on the code field's own submit.

Not doing: motion anywhere else in the sign-in, and no animation library.

## Acceptance

- Pressing "Send me a code" plays one short envelope departure, then the code
  field appears.
- With `prefers-reduced-motion: reduce`, no flight plays and the code field
  still appears.
- A failed send shows its error with nothing animating over it.
- Checked at 390px.
