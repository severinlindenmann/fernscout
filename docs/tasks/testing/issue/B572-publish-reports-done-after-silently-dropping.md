---
id: B572
title: publish reports Done after silently dropping most of an existing trip's trip.md
type: ISSUE
priority: high
complexity: low
area: fernscout-helper, publish, trips
found: "2026-09-06T13:45:05Z"
started: "2026-09-06T14:01:04Z"
merged: "2026-09-06T14:06:48Z"
---

# B572 — publish reports Done after silently dropping most of an existing trip's trip.md

## Why

Found in a real run against fernscout.ch on 2026-09-06, publishing
`content/severin/trips/algarve-2026` with `fernscout-helper`'s `publish` skill.

`.claude/skills/publish/publish.mjs` has two paths for a trip. On **create**
(`publish.mjs:238-248`) it sends everything `trip.md` carries:

    for (const key of ["tagline", "status", "accent", "visibility", "listed",
                       "costsVisibility", "test", "people", "travellers",
                       "rates", "tracks", "translations"])

On **update** — the `else` branch at `publish.mjs:250-269`, taken whenever the
trip already exists — it sends `visibility`/`listed`, then `rates`, and
nothing else. Every other key in that list is read off disk, never sent, and
never mentioned. The run prints `trip is already there`, then `Done. 39 steps.`

So a `trip.md` edited after the first publish does not reach the site, and the
tool says it did. Observed on the live trip after a clean run whose validator
reported 0 errors:

| in `trip.md` | on the site after `Done.` |
| --- | --- |
| `people:` two entries | `[]` |
| `travellers:` two figures | `[]` |
| `accent: sky` | `undefined` |
| intro prose, two sentences | `intro: ""` |

`people:` is the one that costs something. It is write access as well as the
byline, so "my partner was on this trip too" — the ordinary case B524 was
opened for — silently does not happen, and the owner has been told it did.

This is not the API's gap. **B524 built `PATCH …/trips/<trip>/people` and
`…/travellers` precisely for this**, and both work: running them by hand
against the same trip, straight after the failed publish, wrote both blocks and
returned `200` with the access note. `…/tracks` is a third door in the same
shape. The helper simply never walks through any of them.

What genuinely has no door is `title`, `start`/`end`, `cover`, `tagline`,
`accent`, `intro` and trip `translations` — that is B245, still open, and this
ticket does not duplicate it. The distinction matters for the fix: for those
fields the honest behaviour is to *say* they cannot be updated, not to skip
them in silence.

Related: B535 is the same failure one level down — a route dropping what it
does not recognise and answering 200. This is a client doing it to itself.

## Work

In `fernscout-helper`, `.claude/skills/publish/publish.mjs`, the `else` branch
that handles an existing trip:

- Send `people:` and `travellers:` through the B524 doors when `trip.md`
  carries them, and `tracks:` through `PATCH …/trips/<trip>/tracks`. Print one
  step line each, the way `set visibility` and `set the trip's rates` already
  do, so the run's output stays the record of what happened.
- For the fields with no door — `title`, `start`, `end`, `tagline`, `accent`,
  `intro`, `translations`, `cover` — compare against what `GET …/trips/<trip>`
  returns and **print a warning naming each one that differs on disk**, with a
  pointer to B245. Do not fail the run. An unwritable field the operator knows
  about is a different thing from one nobody mentioned.
- `AGENTS.md` in `fernscout-helper` says re-sending "is how an edit on disk
  reaches the site", and the publish `SKILL.md` says a second run "still sends
  the settings and the day bodies again". Both are true of days and false of
  `trip.md`. Correct them.

Not doing: adding the missing API doors — that is B245. Not doing: `cover`,
which has no route to call at all.

## Acceptance

- Publishing a trip that already exists, whose `trip.md` names two people and
  two travellers, leaves both readable through `GET …/trips/<trip>` — with a
  test that runs the publish twice and asserts the second run's result, since
  the bug only appears on the second.
- The same run prints a line per door it used; nothing is written without a
  line.
- Changing `accent:` on an existing trip and re-publishing prints a warning
  naming `accent`, and the run still exits 0.
- `AGENTS.md` and `publish/SKILL.md` no longer claim a re-run carries a
  `trip.md` edit to the site.
