---
id: B754
title: A second trip cannot be made from the wizard when the helper is off
type: ISSUE
priority: low
complexity: low
area: agent, trips
found: "2026-09-07T13:25:28Z"
started: "2026-09-08T20:51:00Z"
merged: "2026-09-08T21:08:53Z"
---

# B754 — A second trip cannot be made from the wizard when the helper is off

## Why

`components/AgentWizard.tsx:703` — when a journal has no trips the wizard shows
`agent.noTrips` and stops. B688's signup wizard creates the first trip before
handing over, so a brand-new journal never meets this. Anybody wanting a
*second* trip does, and with the `helper` capability off there is no ask box
(B685) to make one either.

So on an instance running the helper without a model — which is the default,
and what every self-hoster has — the wizard can write days into trips that
already exist and can never make another one. The person is sent back to an
agent and the API for a thing the page is otherwise perfectly able to do.

Pre-existing, not introduced by B688, found while building it.

## Work

A "new trip" form in the wizard, using the same `POST /api/v1/<user>/trips`
call the signup wizard and the ask box already make. No model, no capability.
B731 wants the visibility question shown when a trip is made from the ask box;
whatever that panel ends up saying, this form should say the same thing.

## Acceptance

An owner with the `helper` capability off can make a second trip from `/agent`
and write a day into it, without leaving the page.

## Resolution

Confirmed still live: `trips.length === 0` in `components/AgentWizard.tsx`
drew only `agent.noTrips` and stopped, and the only in-page way to create a
trip — `POST /api/helper/[user]/trip`, the route the ask box's `create_trip`
confirmation presses — carried its own `isEnabled("helper", user)` gate
(`app/api/helper/[user]/trip/route.ts:57`, before this change) even though
`createTrip` itself never touches a model, as the route's own doc comment
already said. So with `helper` off, both the wizard's own dead end and the
one route that could have filled it were closed.

Turned out not to need `POST /api/v1/<user>/trips` (bearer-only, and this page
is cookie-only by design — B682) — the existing cookie route was the right
door, just wrongly gated.

**Changed:**
- `app/api/helper/[user]/trip/route.ts` — dropped the `isEnabled("helper", …)`
  check and the now-unused `lib/capabilities` import; updated the doc comment
  to say why this route, alone among `app/api/helper/`, carries no capability
  gate.
- `components/AgentWizard.tsx` — `trips` prop is now seeded into local state
  so a newly created trip is selectable without a page reload. Added a "new
  trip" form (title, start, end — the same three fields the ask box's own
  confirmation panel sends, `POST`ed to the same route) shown by default when
  `trips.length === 0`, and behind an "Add a new trip" toggle beside the
  existing trip picker otherwise, so a *second* (or third…) trip is reachable
  without ever leaving `/agent`. No visibility question here yet — matches
  what B731 says the ask box itself does today (still open), so this form
  says the same thing as its sibling, per the Work section above.
- `site/locales/{en,de,hu}.json` + regenerated `lib/i18n.ts` — reworded
  `agent.noTrips` (it used to say only an agent could make a trip, which is
  no longer true) and added `agent.newTripToggle` / `agent.newTripHeading`.
  Reused `agent.tripTitleLabel` / `tripStartLabel` / `tripEndLabel` /
  `createTrip` / `creatingTrip` / `failed` from `SignupWizard.tsx`'s own trip
  step rather than adding near-duplicates.
- `test/agent-wizard-flow.test.ts` — new `describe("making a second trip from
  the wizard")` block, run with the same fixture as the rest of the file
  (`features: { auth: { enabled: true } }` — no `helper` block, the
  self-hoster default). Confirmed red against the pre-fix route (404
  `helper_unavailable`) and green after; also writes a day into the
  newly-created trip through the existing day route, end to end.

**Acceptance, walked:**
- "An owner ... can make a second trip from `/agent`" — `AgentWizard.tsx`'s
  new form; exercised at the route level in the new test
  (`tripRoute` → 201, id derived server-side).
- "and write a day into it" — same test, `POST /api/helper/alex/day` into the
  trip just created → 201.
- "without leaving the page" — the form is inline in `AgentWizard.tsx`
  (client component, no navigation); the trip becomes selectable via local
  state (`setTrips`) with no reload. **Not exercised in a real browser** — no
  browser session available to this agent; verified by reading the component
  and by the route-level test above. A `test-in-a-browser` pass (sign in as
  owner, helper capability off, delete all trips or point at a fresh journal,
  use the new form) would close the gap between "the code path works" and
  "the page renders it correctly at 390px", which is outside what a headless
  test can see per AGENTS.md.

**Could not exercise:** the dev server booting with `helper` both on and off
(AGENTS.md says nothing automates this) — reasoned through instead: the new
form's route (`/api/helper/[user]/trip`) now has no capability check at all,
so its behaviour is identical whichever way `helper` is set; the ask box
itself (chat UI, `HelperRoom.tsx`) is untouched and still gated on `helper` as
before, so nothing about the on-path regressed.
