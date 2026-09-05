---
id: B106
title: Push has never been switched on anywhere, so nothing has proved a notification reaches a phone
type: OPS
priority: medium
complexity: medium
area: push, ops, capabilities
found: "2026-09-03"
related: B102, B103, B104, B105, B107, B108, B109, B110
---

# B106 — Push has never been switched on anywhere, so nothing has proved a notification reaches a phone

## Why

`/api/health` reported `push` as `not enabled on this server`, and there were
no VAPID keys anywhere — it had never been switched on, here or in development.

**Partly stale as of 2026-09-05**: `/api/health` at fernscout.ch now reports
`push: {"enabled": true}`, so keys have been set on the server since this was
written. What has still never happened is the part this task is actually for —
a notification demonstrably arriving on a phone, and the audience questions
below. Read the first paragraph as history and the Work section as still open.
`lib/push.ts` and `/api/push/subscribe` are code nobody has ever run against a
real browser.

Two defects are already filed against it on inspection alone: B68 (a journal
guest is push-notified about a private trip they cannot open — in `testing/`)
and B82 (an expired read grant still notifies, because push does not ask
`lib/grants` — in backlog). A notification is the one thing this project sends
that reaches somebody's lock screen without being asked for, so telling the
wrong person a private trip exists is not a cosmetic bug.

It also cannot be tested locally in any meaningful way: a service worker needs
the real origin over HTTPS. This one genuinely has to happen on fernscout.ch.

## What has been proved, 2026-09-05

**A notification was received on a real iPhone, sent by fernscout.ch.** The
first acceptance criterion, and the one the rest of this ticket was blocked
behind.

The run, so it can be repeated:

- VAPID keys are set in `/etc/fernscout/env` and `/api/health` reports
  `push: {"enabled": true}`. Push is enabled for `example` and for no other
  journal — `severin` and `viki` both answer `enabled: false`, which is why no
  bell renders on them.
- One subscription exists: `owner_id=example`, tied to a contact record, via
  `https://web.push.apple.com/…`, from `iPhone OS 18_7 / Safari 26.6.1`.
- `npm run notify -- --latest --user example --dry-run` resolved 1 subscriber;
  the real run reported `sent 1 / 1`, `pruned 0`.
- The day was `usa-2026 / oregon-coast`, a **public** trip — so this exercises
  the `isOpenToLink` arm of `subscribersFor`, where every subscription for the
  journal qualifies. It says nothing yet about the restricted arms.
- Confirmed received and correct by the person holding the phone.

Two defects were found and fixed on the way, and both are why nobody had got
this far before: **B438** (the control sampled for a service worker once, at
hydration, lost the race against the registrar's `load` handler, and rendered
`null` for ever) and **B439** (the only switch was inside `TripHero`, which
renders on the story's landing step alone). **B440** then added the soft
prompt, since finding the bell was the remaining barrier.

## Still open on this ticket

The audience questions, which are the part that matters and none of which the
run above touched:

- **B68** — a journal guest must not be notified about a `private` trip.
- **B82** — an expired read grant must not notify.
- A **draft** day, and a **`test: true`** day, must notify nobody at all.
- What a stale subscription or a permission revoked after subscribing does —
  loudly, quietly, or for ever.
- Android. Only iOS has been tried.

There is now a real subscription on the live instance to observe, so these can
be driven rather than reasoned about.

## Related

One campaign, not nine tasks: every capability this instance can switch on,
driven once against fernscout.ch by somebody who can read the answer. They
share the standing rules, the test journal and the rule that every defect
becomes its own capture. The order is forced — B102 first (everything else
arrives by mail), then B103, and the rest in any order. B101 is the same
shape pointed at the gate rather than the feature.

## Work

Generate a VAPID keypair and set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and
`VAPID_SUBJECT` in `/etc/fernscout/env` — the names are already in
`.env.example`. Enable the capability and confirm `/api/health` moves off
`not enabled on this server`.

Then, from a real phone:

- subscribe, publish a day in the test journal, and check what arrives — the
  text, the icon, and above all where the link lands;
- the audience, which is the part that matters: a guest subscribed to the
  journal must not be notified about a `private` trip (B68); an expired grant
  must not notify (B82); a draft and a `test: true` day must not notify anyone
  at all;
- what happens when the subscription is stale, or the browser permission was
  revoked after subscribing — does the send fail loudly, quietly, or forever;
- iOS and Android both, if you have both to hand.

Standing rules for this run: any secret goes in `/etc/fernscout/env` and
nowhere else — never `content/config.json`, never a commit, never echoed back
into a chat. Work in a journal created for this, with days carrying
`test: true`, and do not write into a journal somebody is actually using.
Leave the instance as you found it, or say in this task what you left switched
on. Every defect becomes its own backlog task referencing this id — do not fix
anything here, so the finding and the fix stay separate records. B101 is the
same shape: an engagement whose output is other tasks.

## Acceptance

- One notification demonstrably received on a phone, sent by fernscout.ch.
- B68 and B82 each confirmed or contradicted against the running site.
- A recorded answer on what a guest, a draft and a `test: true` day each
  produce — including the ones that correctly produced nothing.
- Which platforms were tried, and which were not.
- One backlog task per new defect, referencing B106, and a stated decision on
  whether push stays on afterwards.
