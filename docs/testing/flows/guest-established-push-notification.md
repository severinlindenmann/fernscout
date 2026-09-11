# Flow: guest-established-push-notification

**Persona:** `guest-established` (docs/testing/personas/guest-established.md)
**Interface:** journal UI
**Capabilities exercised:** `push`
**Device/locale:** run at the requested viewport, in a real browser context
(the Push API and `MediaRecorder`-style permission prompts are browser-only
and cannot be simulated with `curl`).
**Check type:** technical (a real subscription row, a delivered payload) and
graphical (the opt-in prompt and the notification itself, at the requested
viewport).

## Setup

1. Local dev server running with `features.push` on and
   `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` set to a
   generated pair (`npm run notify -- --generate-keys` — no paid account,
   matching AGENTS.md's rule that no capability needs one to develop).
2. A `test-guest-established` journal with the persona already approved on a
   `guest` trip carrying at least one published day.

## Steps

1. As `guest-established`, open the journal in a real browser and accept the
   `PushOptIn` prompt (`components/PushOptIn.tsx`). Confirm
   `GET /api/push/subscribe?user=test-guest-established` reports
   `enabled: true` and hands back the public VAPID key, and that the
   resulting `POST` to the same route records a subscription
   (`lib/push.ts`'s `saveSubscription`).
2. As the owner, publish a new day (or use one already published for this
   run).
3. Run `npm run notify -- --latest --user test-guest-established --trip
   <trip>` — the same script an operator would run, since nothing in this
   codebase sends a push automatically on publish (`scripts/notify.mts`'s own
   module comment: "Send a push notification about one day to whoever opted
   in and can see it").
4. Confirm the browser receives and displays the notification, linking to
   the day's own page.

## Done when

- The subscription is recorded against the right journal and endpoint
  (technical check, `listSubscriptions` for the journal shows one row for
  this browser).
- The notification is delivered and its link opens the correct day
  (technical check).
- The opt-in prompt and the resulting notification both render correctly at
  the requested viewport (graphical check).
- A reader who never opted in receives nothing, and a subscriber to a
  `private` trip (or a `guest` day inside an otherwise open trip) is excluded
  from the send by `subscribersFor` before `web-push` is ever called
  (technical check — `lib/push.ts`'s own gate, checked at notify time rather
  than at subscribe time).
