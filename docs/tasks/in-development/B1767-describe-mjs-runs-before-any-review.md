---
id: B1767
title: describe.mjs runs before any review exists, so prose is written from photographs the person later removed
type: ISSUE
priority: high
complexity: medium
area: fernscout-helper icloud-export, describe.mjs, build.mjs
found: "2026-09-15T06:24:07Z"
started: "2026-09-15T06:39:45Z"
session: 135632db-3afb-4bd0-bf02-4ee0fb20ab0d
claimed: "2026-09-15T06:39:45Z"
---

# B1767 — describe.mjs runs before any review exists, so prose is written from photographs the person later removed

## Why

The order the tools are actually run in is export → describe → review → build,
and it is the wrong way round. `describe.mjs` makes a contact sheet of every
photograph of a day; whoever reads those sheets writes `observed` for each
frame; the person then opens the review page and turns some frames off. The
prose an agent later writes from those observations therefore describes
photographs that are no longer in the journal.

The guard that would catch it is written as if it existed and does not.
`.claude/skills/icloud-export/describe.mjs` reads `review.json` inside a bare
`try { … } catch {}` — a missing file means "nothing was dropped", which is
indistinguishable from "nothing has been reviewed yet", and the run proceeds
over every photograph without a word. `build.mjs` then writes `notes.md` from
the review with no comparison of when either was written, so a sheet, an
observation and a review made in the wrong order all still produce a green run.

What it costs is not detail. In one real run 51 of 147 days carried prose
describing removed photographs, and one day's text opened by describing the
payment cards its owner had just turned off for privacy: the photograph was
removed and the sentence about it was published.

## Work

- `describe.mjs` refuses to run unless `review.json` exists with a non-empty
  `photos` map, or `--before-review` is passed to say the order is deliberate.
  The refusal names the review command.
- `build.mjs` warns per day when the observation or the prose it is building
  from is older than `review.json`'s own mtime — the photographs behind those
  words may have been turned off since.
- The order in `icloud-export/SKILL.md` becomes export → review → describe →
  build, and says why.

Not doing: deleting or rewriting prose automatically. Which sentence described
which frame is not knowable from the file, and the correct move is to tell the
person and the agent, not to guess.

## Acceptance

`node describe.mjs --trip <t>` on an export with no `review.json` refuses and
says what to run first; with `--before-review` it runs as it does today. With a
`review.json` newer than an entry's prose, `build.mjs` prints a warning naming
the day.
