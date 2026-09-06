---
id: B608
title: The file shape a journal must have is not published anywhere
type: FEATURE
priority: high
complexity: medium
area: api, content model, validation
found: "2026-09-06T15:11:52Z"
started: "2026-09-06T15:12:43Z"
session: ac8af30e-815d-4843-a94d-cf061a70269c
claimed: "2026-09-06T15:12:43Z"
---

# B608 — The file shape a journal must have is not published anywhere

## Why

**Design: `docs/plans/W41-the-file-shape-is-published.md`.** Read it first;
this task is steps 1 and 2 of its Order section.

`fernscout-helper` follows this instance rather than defining anything —
types, enums, required lists and upload limits are all fetched from
`openapi.json` and `/api/health` at run time. In a full day of finding bugs in
those tools, not one was a stale type, enum or limit. Everything fetched has
stayed correct.

The file shape is the one part of the contract this server does not publish,
so it is the only part the helper has to copy, and every drift found was
there: `coordinates`/`photos` documented as "only ever false" after the server
gained `"unknown"` (B585); a `features` block never checked for shape, so a
bare boolean validated clean while the server reverted it to off (B598); and
before both, `unrecorded: [costs]` arriving and a good journal coming back with
two errors, both wrong.

## Work

- `GET /content-model.json`, public and unauthenticated, alongside
  `openapi.json`. Version it: `"contentModel": 1`.
- The rule vocabulary is **closed** — exactly the eight `assert` kinds in W41,
  one wildcard (`*`, for a map's members), nothing executable. Anything that
  does not fit is declared as a `named` check with an `id` and a `because`,
  not expressed.
- Derive the first version from `fernscout-helper`'s
  `.claude/skills/shared/model.mjs` (read it at
  /Users/severin/Documents/GitHub/fernscout-helper). A faithful copy — no
  behaviour change on either side in this step.
- `test/content-model.test.ts`: run `lib/validate/*` and the rule set over the
  same fixtures and assert they agree, rule by rule. In `npm run verify`, so
  the build fails when they part.
- Expect the conformance test to *find* disagreements. B585 is one already.
  Each one is a capture for `backlog/`, by id, not scope absorbed here.

Not doing: refactoring `lib/validate/*` to consume the rule set — W41 says why.
Not doing: any client change; that is B609.

## Acceptance

- `curl <site>/content-model.json` returns a versioned document describing
  `config.json`, `trip.md`, `costs.md`, `plan.md` and an entry.
- Every `assert` in it is one of the eight kinds; a test asserts that.
- `test/content-model.test.ts` passes and fails when a rule is changed to
  disagree with `lib/validate/*`.
- `npm run verify` green.
