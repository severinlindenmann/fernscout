---
id: B69
title: The one-tap sign-in link always lands on the journal home, losing the page you were trying to read
type: ISSUE
priority: medium
complexity: medium
area: auth, ui
found: "2026-09-01"
started: "2026-09-01"
---

# B69 — The one-tap sign-in link always lands on the journal home, losing the page you were trying to read

## Why

`app/[user]/s/[token]/route.ts` ended with `Response.redirect(`${site}/${username}`, 303)`.
Whatever the reader was trying to open, the button in the mail put them on the
journal's front page.

That was harmless while sign-in lived only on `/<user>/me`, which is where you
go when the only question is "what can I see?". **B39 moved it in front of
every closed trip**, and now the ordinary path is: follow a link to
`/<user>/trips/vietnam-2026`, meet the gate, ask for a code, open the mail, tap
the button — and arrive somewhere else, with no mention of the trip that
started it. The trip is in the switcher if it is `listed`, and a `guest` trip
is never listed, so for the reader this is a link that did not work.

**B39 is also why this got worse rather than merely staying annoying.** It
shipped, and it took the trip password with it: e-mail sign-in is now the
*only* way into a closed trip. Before, somebody sent a link and a word could
open the trip without ever meeting this route. Now every single gated visit
goes through the mail, so every single gated visit ends on the wrong page.
The papercut became the default path.

Note the two halves of the flow disagree. Typing the six digits into the form
reloads the page you are on, so it lands correctly. Only the button — the path
built for the reader least likely to type anything — loses the destination.

## Work

- Carry a return path from the form to the mail: `TripGate` knows the current
  path, `GuestSignIn` sends it, `POST /api/auth/request` takes it, `issueCode`
  stores it with the link token, and `/[user]/s/[token]` redirects there.
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

## How it was built

**Where the destination is carried: a column, not the URL.**
`009-signin-destination` adds `login_codes.link_dest`. `GuestSignIn` posts the
path to `/api/auth/request`, `issueCode` writes it beside the link's hash, and
`verifyLink` reads it back and returns it as `destination`. `signInUrl` is
unchanged — the mailed URL still carries nothing but the token, and there is no
query parameter, header or argument anywhere that sets a redirect target on the
request that follows it. A destination somebody can edit between receiving the
mail and following the link would be the open redirect in a different costume;
one written down when the code was issued is a note to self.

**How it is constrained: `safeDestination(username, value)` in `lib/auth`.**
Two questions, both of which must answer yes. Is it a path on this origin — a
single leading `/`, no scheme, no `//host`, no `/\host`, no whitespace, control
characters or backslashes, no query and no fragment? And, after being resolved
against a base that exists nowhere so that `..` and the `%2e%2e` the URL parser
also treats as a dot segment are normalised away, is the result `/<username>`
or `/<username>/…`? Anything else returns null, and null means the journal
home, which is where this always went. It runs **at redemption, on the value
read out of the database**, not only when the value is stored — the stored
value is the input, and a future bug, a restored dump or a hand-edited row must
not be able to hand a reader to somebody else. It also runs on the way in, so
nothing unusable is written down; that copy is the convenience, not the guard.

**The six-digit code path deliberately carries no destination.** `/api/auth/verify`
is untouched. The form never navigates away: `submitCode` calls
`window.location.reload()`, so the reader is still standing on the page they
were trying to open and it re-renders as the thing they came for. There is no
round trip for a destination to survive, which is the entire reason the link
needed one. Adding a redirect target to `verify` would create a second
attacker-controlled redirect input serving no reader at all — the code path is
already correct, and the cheapest way to keep it correct is to give it nothing
to get wrong. A reader who types the code lands in the same place as one who
taps the button, by a different mechanism.

**A stale destination.** Only a trip that has *gone* falls back. `landing()` in
the redemption route checks that a `/<user>/trips/<id>` destination still
resolves through `getTrip`, because half an hour is long enough for the owner
to delete it and a link that signs somebody in and then shows them a 404 is a
worse ending than the front page. A trip that still exists but is closed to
this reader is **not** stale and is not redirected away from: that lands on the
gate, which is the page that explains itself and offers the way on — exactly
the outcome this section asked for. An expired or already-spent link still goes
to `/<user>/me?signin=expired` and is not diverted by a destination.

**Where a destination is and is not sent.** Only `TripGate`, which passes
`usePathname()` — the gate renders in place of whatever route was asked for, so
that is the trip, or the individual day inside it, that the reader clicked.
`/<user>/me` passes nothing. Neither do the standing welcome link, the relay
link, the digest footer or the contact mail; all of them keep landing on the
journal. An agent code never stores one — it has no link to follow, and a note
of what somebody was reading does not belong in a row nothing will read.

## Acceptance

- Signing in from a trip URL by tapping the button lands back on that trip.
- Signing in from `/<user>/me` still lands on the journal, as now.
- A stored destination pointing outside `/<username>/` is refused and the
  reader lands on the journal home instead — with a test.
- The four checks.

## Evidence

`npx vitest run` — 90 files, **1471 passed, 1 skipped, 0 failed**. The same
command at the branch point: 89 files, 1443 passed, 1 skipped. All 28 new tests
are in `test/auth.test.ts` (`describe("where the sign-in link lands")`) and
`test/signin-destination.test.ts`, which drives the real route and asserts the
`Location` header.

| Acceptance line | Evidence |
| --- | --- |
| Lands back on that trip | `signin-destination.test.ts` → "signing in from a trip lands back on that trip" and "a day inside a gated trip is kept". Reverting the route's one line to `${site}/${username}` fails 3 tests, so they are load-bearing. |
| `/<user>/me` still lands on the journal | `signin-destination.test.ts` → "signing in from /<user>/me still lands on the journal" — `/me` sends no destination, and the route answers `https://example.test/ana`. |
| An outside destination is refused, with a test | `auth.test.ts` → 11 crafted values written straight into `link_dest` past the inbound check (absolute URL, `//host`, `/\host`, `javascript:`, another journal, a journal whose name merely starts the same way, `..`, `%2e%2e`, `/api/health`, a smuggled newline, empty) each verify to `destination: null`; `signin-destination.test.ts` asserts the `Location` header is the journal home for four of them. Making `verifyLink` return `row.link_dest` untouched fails 14 tests. |
| The four checks | `npx tsc --noEmit` clean; `npx eslint .` 0 errors, 4 warnings — the same four as main, none added; `npx vitest run` as above; `npm run build` succeeds. |
