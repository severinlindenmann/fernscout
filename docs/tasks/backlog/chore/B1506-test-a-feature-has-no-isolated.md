---
id: B1506
title: test-a-feature has no isolated CONTENT_DIR, so a local run writes into the tracked demo journal
type: CHORE
priority: medium
complexity: medium
area: docs-and-skills
found: "2026-09-11T18:55:59Z"
---

# B1506 — test-a-feature has no isolated CONTENT_DIR, so a local run writes into the tracked demo journal

## Why

Found running all 14 `docs/testing/flows/` against a plain `npm run dev` in
the main checkout (no `CONTENT_DIR` override), because none of the docs said
to set one. `content/example/` is the shipped demo journal, tracked by git —
and it's also `defaultUser`, the obvious pre-seeded journal with real
published trips/days that `owner-established`-lifecycle flows are supposed
to run against (per AGENTS.md's own B1090 point: test against content that
already existed). Every write the flows made — a cost line via `PATCH
.../costs`, a reaction via `POST /api/reactions` — landed directly in the
tracked working tree (`content/example/trips/parks-2025/costs.md`,
`content/example/trips/asia-2023/entries/2023-02-10-chiang-rai-by-car.md`),
which then had to be `git checkout --`'d back to clean before the shared
checkout was safe to leave.

This is the same discipline problem AGENTS.md already enforces for code (the
main-checkout guard hooks) but nothing enforces it for a *content* write a
local test run makes, and it's easy to trip: any flow using `example` as its
"already-existing content" persona journal will do this.

## Work

Either: (a) `docs/testing/flows/*.md` Setup steps should say explicitly to
run the dev server with `CONTENT_DIR` pointed at a scratch copy of
`content/example` (`cp -r content/example /tmp/fernscout-test-content/example`
or similar) rather than the checkout's own `content/`, or (b)
`.claude/skills/test-a-feature/SKILL.md` should own this as part of its
"assemble a run" job — set up the scratch `CONTENT_DIR` automatically before
handing back which flows to drive, so a session following the skill can't
get this wrong. (b) is probably the right layer, since it's exactly the kind
of setup `test-a-feature` already claims to assemble.

Not doing: writing the scratch-copy logic myself here — this ticket is the
capture, not the fix.

## Acceptance

Following `test-a-feature`'s own instructions (or the flow files' Setup
steps) for an `owner-established` flow no longer touches
`git status` in the main checkout — a scratch content directory absorbs the
writes instead.
