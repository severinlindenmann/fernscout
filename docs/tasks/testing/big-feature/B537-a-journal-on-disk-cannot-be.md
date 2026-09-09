---
id: B537
title: A journal on disk cannot be checked against the instance that will receive it
type: FEATURE
priority: high
complexity: high
area: skills, api, validation
found: "2026-09-06T12:30:00Z"
started: "2026-09-09T04:56:00Z"
merged: "2026-09-09T05:16:20Z"
---

# B537 — A journal on disk cannot be checked against the instance that will receive it

## Why

An agent holding a folder of content — `fernscout-helper/content/severin` is
the live example, one trip, 14 entries, a `costs.md` and eight media folders —
has no way to ask *"is this right, and what will the instance refuse?"* short
of writing it and finding out. Which is exactly the run B531 and B533 are
about: every call answered 200, and 22 cost lines never left the laptop.

The gap is not knowledge. `/openapi.json` publishes the field list,
`/agent.md` explains it, the skills carry it in prose. The gap is that
**nothing compares a folder to it.** An agent reading fourteen files through a
filter of its own making is the failure mode, and asking it to read more
carefully has now been tried.

## Work

Three pieces, and the ordering between them is the whole design: **the rules
are written once, on the server, and the skill never re-states them.** A skill
that carries its own copy of the field list is the third copy to drift, after
`add-a-day` and `openapi.ts`.

**1. A dry run.** `POST /api/v1/<user>/trips/<trip>/days?dry_run=1` — same
auth, same trip gate, same body, runs the same checks, writes nothing and
answers the `problems` list it would have answered. That is B535's `checkBody`
for shape and B531's contract for substance, in the one place both already
run. No second implementation, and it stays correct as those two change.

Answer 404 for an unknown or unwritable trip exactly as the write does, and
`200 { ok: true, problems: [], warnings: [] }` when clean — so a clean day and
a refused one are the same shape and the caller does not branch on status
alone. Nothing is written, no idempotency key is consumed, no slug reserved.

**2. The frontmatter → field mapping, served.** B533 is already generating
this table for the guide "from the same definitions the rest of the guide
renders". Serve that same structure as JSON — `GET
/api/v1/schema/content` — so the skill can walk a file's keys rather than the
ones it remembers. It must name the keys that do **not** cross: `status:
draft` is the publish call, `gallery:` is the media call, `id:` is the URL.
Public and journal-independent, like `/openapi.json`.

**3. The procedure, in `/agent.md`.** Asked for as a skill in this checkout,
and written here as a section of the guide instead, for two reasons that point
the same way:

- The agent that needs it is standing in **another repository** —
  `fernscout-helper/content/severin` is the live example. A `SKILL.md` in this
  checkout cannot reach it. `/agent.md` is fetched over the network, which is
  exactly where that agent already is.
- `AGENTS.md` moved the content-writing skills out of the checkout on
  2026-09-06 for this reason: writing content is the network door's job. A
  `validate-content` skill here would be the one exception, re-stating field
  lists that had just been consolidated.

If a checkout-local skill is still wanted, it is a ten-line wrapper that says
"fetch `/agent.md`, follow the *Checking a folder* section" — worth having,
worth being that thin, and its own capture.

The procedure itself. It does not know the rules; it fetches them.

    for each trips/<id>/trip.md and entries/*.md
      read EVERY key of the frontmatter — the mapping from (2) is the list,
        not recall
      map to API fields, POST dry_run=1, collect problems
    then the checks a server cannot make, because the files are here:
      every gallery: src exists on disk, and its format and dimensions pass
        lib/validate/media.ts's rules
      media/<slug>/ folders with no entry, and entries with no media folder
      duplicate slugs; dates outside the trip's start/end
      costs.md and plan.md parse
    report: one line per problem, grouped by file, and a summary count

The report is the deliverable — **it fixes nothing**. An agent that both finds
and silently corrects gives nobody a chance to see what was wrong, and half
these problems ("no costs on seven days") are a question for a person, not a
defect.

**Degrade honestly without a token.** `/openapi.json` and (2) are public, so a
tokenless run still checks shape, files and formats, and says in the report
that the trip-level contract was not checked and why. It must never imply a
clean bill it did not earn.

Not doing: writing or repairing content; a hosted "upload this folder" flow;
validating `content/.mail` or generated output.

## Acceptance

- `POST .../days?dry_run=1` with a good body answers `problems: []` and writes
  no file; with `transport_mode` it answers the same 400 shape the real POST
  does; for an unwritable trip it answers 404 like the write.
- `GET /api/v1/schema/content` lists every frontmatter key with its API field,
  and names `status`, `gallery` and `id` as not crossing.
- Run against `fernscout-helper/content/severin` — one trip, 14 entries, a
  `costs.md`, eight media folders — the procedure reports the seven days
  carrying `costs:` and whatever else is genuinely wrong, and changes nothing
  on disk.
- Run with no token, the report says the contract was not checked.
- The `add-a-day`/`add-a-trip` field lists are not restated anywhere in it.
- `npm run verify` green.

## Sequencing

Depends on **B535** (`checkBody`, so the dry run has something to run) and
**B533** (the mapping, so piece 2 serves it rather than inventing a second
one). Piece 3 is the only part that can start early — the skill against
`/openapi.json` alone, with the dry run added once B535 lands.

Written 2026-09-06 alongside B535/B536; the b531-day-contract, b325-day-weather
and composer worktrees were all live. This one touches no file any of them has
open until its route work begins.
