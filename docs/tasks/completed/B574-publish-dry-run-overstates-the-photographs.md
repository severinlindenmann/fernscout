---
id: B574
title: publish --dry-run overstates the photographs it will upload
type: ISSUE
priority: medium
complexity: low
area: fernscout-helper, publish, media
found: "2026-09-06T13:45:45Z"
started: "2026-09-06T13:50:06Z"
merged: "2026-09-06T14:01:04Z"
completed: "2026-09-07T13:12:08Z"
---

# B574 — publish --dry-run overstates the photographs it will upload

## Why

Found on 2026-09-06 in the same run as B572. The dry run said it would send
**75 files**; the real run sent **15**. The other 60 were already on the site.

`publish.mjs:346`:

    const there = dry ? { ok: false } : await call("GET", …/days/${slug}`);

Under `--dry-run` the day is treated as absent, so `already_uploaded` is empty
and every gallery item counts as pending. The plan then reports the full
gallery for every day — "would send 14 files for vom-ersten-ins-zweite-hotel"
where the real answer was 7.

The skip is deliberate in spirit: a dry run should not need the network. But
the run has already made a `GET …/days` call one screen earlier to match days
by date and title, so it is online regardless, and the day list it holds is
what would answer the question.

Why it matters more than the arithmetic: the skill says the dry run is *"the
one cheap moment to notice that a trip is about to be created twice under two
ids, or that fourteen days are about to go up when they meant one"*, and tells
the agent to read it back to the person before the real run. A plan that is
wrong by five times on the one number measuring time, bandwidth and the
operator's Open-Meteo-style costs is a poor thing to be reading aloud. It also
inverts the reassurance in `SKILL.md` that a second run is cheap: a dry run
before a second publish reports the entire library again, which reads as
"about to re-upload everything".

## Work

- Fetch each day's gallery in dry mode too, and compute `pending` from it, so
  the printed count is the count. The list from `GET …/days` is already in
  hand; a per-day `GET` is the same call the real path makes.
- If a no-network dry run is worth keeping as a mode, say which one it is in
  the output — a plan that could not ask must not print a number that looks
  like it did. `--offline` is the flag `validate-content` already uses for
  exactly this distinction.
- The batching line ("in N batches") is computed from the same `pending` and
  is wrong for the same reason; it comes right for free.

Not doing: caching gallery listings between runs. The site's own copy being the
record — no local state file — is the property that makes a second run safe,
and it should stay.

## Acceptance

- On a trip whose days are already fully uploaded, `--dry-run` reports no files
  to send, and a subsequent real run sends none.
- On the mixed case, the dry run's per-day counts equal what the real run then
  sends, asserted by a test that runs both against a fixture.
- The output states plainly when it is planning without having asked the site.
