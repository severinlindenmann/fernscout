---
id: B63
title: The one-tap sign-in link always lands on the journal home, losing the page you were trying to read
type: ISSUE
priority: medium
complexity: medium
area: auth, ui
found: "2026-09-01"
---

# B63 — The one-tap sign-in link always lands on the journal home, losing the page you were trying to read

## Why

`app/[user]/s/[token]/route.ts` ends with `Response.redirect(`${site}/${username}`, 303)`.
Whatever the reader was trying to open, the button in the mail puts them on the
journal's front page.

That was harmless while sign-in lived only on `/<user>/me`, which is where you
go when the only question is "what can I see?". **B39 moved it in front of
every closed trip**, and now the ordinary path is: follow a link to
`/<user>/trips/vietnam-2026`, meet the gate, ask for a code, open the mail, tap
the button — and arrive somewhere else, with no mention of the trip that
started it. The trip is in the switcher if it is `listed`, and a `guest` trip
is never listed, so for the reader this is a link that did not work.

Note the two halves of the flow disagree. Typing the six digits into the form
reloads the page you are on, so it lands correctly. Only the button — the path
built for the reader least likely to type anything — loses the destination.

## Work

- Carry a return path from the form to the mail: `GuestSignIn` knows the
  current path, `POST /api/auth/request` would take it, `issueCode` would store
  it with the link token, and `/[user]/s/[token]` would redirect there.
- **It is a redirect controlled by request input, so it is an open-redirect
  hazard.** Store it, never echo it: accept only a path (leading `/`, no `//`,
  no scheme), and refuse anything not under `/<username>/`. Both checks, at
  redemption time, on a value read from the database rather than from the URL.
- Decide what a stale destination does — a trip that was deleted, or one the
  reader still may not read. Landing on the gate again with the right sentence
  is fine; a 404 is not.
- The same link is in digest and contact mail (`signInUrl`). Leaving those
  pointing at the journal home is correct; only the gate's own request should
  carry a destination.

## Acceptance

- Signing in from a trip URL by tapping the button lands back on that trip.
- Signing in from `/<user>/me` still lands on the journal, as now.
- A stored destination pointing outside `/<username>/` is refused and the
  reader lands on the journal home instead — with a test.
- The four checks.
