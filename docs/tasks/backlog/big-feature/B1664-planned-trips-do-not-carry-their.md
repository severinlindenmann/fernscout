---
id: B1664
title: Planned trips do not carry their people and followers cleanly into departure
type: FEATURE
priority: medium
complexity: high
area: planned trips, figures, people, buddy invites, followers, notifications
found: "2026-09-13T12:56:51Z"
---

# B1664 — Planned trips do not carry their people and followers cleanly into departure

## Why

An upcoming trip already has most of the nouns this needs, but they do not form
one dependable pre-departure workflow. A trip document can name `people`, the
figures library can draw travellers, `plan` can describe the intended route,
and the invite system can create a trip-scoped buddy. An owner cannot yet set
up the whole travelling party, invite the people who will write with them, and
invite read-only followers while the trip is still a promise rather than a
published journey.

The missing follower case is not the existing journal-wide guest grant. The
invitation is about one planned trip: before departure the reader should see a
teaser, title, dates and the planned route, then follow that same trip once it
starts. Granting every `guest` trip in the journal merely because somebody
followed one planned trip would be a surprising widening of access.

The departure boundary is also unproven as a whole. B1219 already supplies an
opt-in owner reminder while a trip is running, and the map already has a notion
of planned stops during a current trip. Those pieces need to survive and read
as one lifecycle: the party and subscriptions remain attached to the same trip,
the owner gets a useful prompt to add today's update, followers are told the
trip has begun, and readers can distinguish the road travelled from the route
still planned. A planned stop is never evidence that the traveller reached it.

## Work

Treat this as four faces of one planned-trip lifecycle. Keep the agent as the
editor: this does not add a CMS form for composing a trip or its plan.

### A. Party and figures before departure

- Let the owner add the named people expected to travel through the existing
  agent/API trip-writing path, and choose an existing illustrated figure for
  each one. Show the resulting party on the planned trip.
- Preserve the distinction between editorial credit and authority. `people`
  and its figure links are the owner's statement of who is going; approving an
  invite must not silently rewrite that statement.
- Make incomplete setup legible: a named traveller can be not invited yet,
  invited, awaiting approval, or joined. Do not infer one state from another.

### B. Buddies before departure

- Reuse the existing trip-scoped buddy invitation and approval model, with
  either a copyable link or an email addressed by the owner.
- A buddy approved before departure can read and write that one trip already,
  including through their trip-scoped agent credential, without gaining owner
  authority or access to another private trip.
- Put the invite action and its current state beside the planned party so the
  owner can finish setup before leaving.

### C. Read-only followers and the teaser

- Add a trip-scoped, read-only follower relationship rather than overloading
  the journal-wide guest grant or the write-capable buddy row. It must have the
  same pending, approval, expiry and revocation discipline as existing access.
- Let the owner issue one forwardable follower link or send it to a named email
  address. Before the trip starts, an approved follower sees only its teaser,
  title, dates and planned route. They never see drafts, private media, inbox
  content, addresses, costs, or another closed trip.
- At acceptance, offer notification by email and by web push. Beside push, link
  to the localised installed-app instructions at `/docs/guide/guest` and explain
  that installation is how the page behaves like an app. A browser that cannot
  install the PWA can still subscribe where push is supported.
- WhatsApp and physical-postcard notification are deliberately later channel
  extensions. Keep the subscription model capable of adding channels, but do
  not make this ticket depend on provider templates, telephone consent,
  addresses, print credit, or a paid send.

### D. The moment the trip starts

- Do not copy or recreate the trip at departure. The same stable trip id keeps
  its people, figures, buddy grants, follower grants, plan and subscriptions as
  its date-derived state changes from upcoming to running.
- Notify each opted-in follower exactly once when the trip first becomes
  current, then use the ordinary new-day notification path for later published
  updates. Retries must be idempotent, and no draft may trigger a reader mail or
  push.
- Build on B1219's owner reminder. If the plan has a stop for today, the nudge
  may say where the owner planned to be and link to `/agent` to add an update;
  otherwise it stays generic. It must never claim the planned place is where
  the owner actually is.
- On the running trip and map, show actual progress separately from the
  remaining planned route. An authorised reader can see where the rest of the
  journey is intended to go without a future draft leaking into that route.

Related work to respect rather than duplicate: B33 (buddy grants), B34
(canonical shared-trip presentation), B909 (the plan API), B1219 (owner
reminders), B1395 (buddy identity details), B1410 (returning invite redemption),
B1476 (upcoming-trip wording), and B1616 (adding people after a prior decline).

## Acceptance

- An owner creates an upcoming test trip through the agent/API, adds two named
  participants, assigns each an existing figure, and the planned-trip page
  shows both figures and each person's invitation state.
- The owner can copy or email a buddy invitation before departure. Once
  approved, that person can read and write the named trip and no other private
  trip; approval does not silently change the owner's `people` or figure
  choices.
- The owner can copy or email a follower invitation. Before departure an
  approved follower sees the title, dates, teaser and planned route, but is
  refused drafts, restricted media, costs and unrelated closed trips.
- The follower can choose email and, on a capable browser, push. The push UI
  links to the translated install guide. Revoking the relationship stops both
  access and future notifications.
- Moving the clock across the trip's start leaves the same trip and all of its
  party/access data intact, emits one idempotent start notification per opted-in
  follower, and never publishes or exposes a draft.
- With the owner reminder enabled, a running trip with no update today links
  the owner to `/agent`; a matching planned stop is phrased as a plan, never as
  their measured location. A second sweep that day does not send it again.
- The running trip and map visibly separate actual travelled progress from the
  remaining plan on desktop and phone. The scenario is covered for owner,
  buddy, follower and stranger, with mail and push simulated locally.
