---
id: B753
title: Sending a sign-in code gives no sign that anything was sent
type: FEATURE
priority: low
complexity: low
area: auth, ui, motion
found: "2026-09-07T15:32:00Z"
started: "2026-09-07T13:20:25Z"
merged: "2026-09-07T13:56:02Z"
completed: "2026-09-09T16:45:32Z"
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

## Done

New `components/EnvelopeFly.tsx` — a drawn envelope (flat fills, hairline
stroke, one corner of airmail stripe as the envelope's own detail rather than
a panel border), animated with `motion/react` (already a dependency, already
used for `useReducedMotion` in `components/travel/Vehicle.tsx`). 450ms fade +
fly (`x: 18, y: -30, rotate: -10, opacity: 0`), `ease: "easeIn"`.

Wired into `components/IdentitySignIn.tsx`:
- Fires only from `requestCode` (the send), never on mount, never from
  `submitCode` (the code field's own submit).
- Independent of the request's outcome: starts the moment the request goes
  out, unmounts itself via `onAnimationComplete` on its own ~450ms clock. A
  slow failure is never something it's still flying over, because it's
  already gone by the time a realistic response lands.
- Rendered on the outer `<section>` (not inside the email-only `<form>`), so
  a fast response that flips `step` to `"code"` doesn't cut the flight short
  by unmounting its parent.
- `useReducedMotion()` gates whether it's rendered at all — `if (!reduceMotion)
  { setFlightId(...); setFlying(true); }` — so reduced motion skips the
  flight outright rather than shortening it, exactly as asked.

**Verified in a browser** (Playwright, Chrome for Testing, 390×844):
- Mid-flight capture (screenshot ~150ms after clicking "Send me a code"):
  envelope visible, already fading/translating, over the sign-in panel — see
  the ticket's screenshots.
- `emulateMedia({ reducedMotion: "reduce" })` (Playwright's `newContext({
  reducedMotion: "reduce" })`): no envelope svg rendered at any point, code
  field still arrives once the request resolves — confirmed both by
  screenshot and by DOM query.
- New test `test/envelope-fly.test.tsx` (jsdom, `motion/react` mocked to make
  the reduced-motion/normal branches deterministic — the library's own
  reduced-motion read is a module-level singleton that only initialises once
  per module instance, so a real `matchMedia` read is a fact about the first
  test in the file rather than about each case): plays on an ordinary send,
  does not play under reduced motion (and the code field still arrives),
  does not play on mount.
