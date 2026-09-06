---
id: B609
title: The helper copies the file shape instead of reading it from the instance
type: FEATURE
priority: high
complexity: medium
area: fernscout-helper, validate-content, content model
found: "2026-09-06T15:11:52Z"
started: "2026-09-06T15:12:44Z"
merged: "2026-09-06T15:41:06Z"
---

# B609 — The helper copies the file shape instead of reading it from the instance

## Why

**Design: `docs/plans/W41-the-file-shape-is-published.md`.** Read it first;
this task is step 3 of its Order section. Depends on B608 having published the
document.

The helper's `.claude/skills/shared/model.mjs` is 263 lines of copied truth
about what a journal on disk may contain, and `validate-content/validate.mjs`
is 652 lines of rules written against it. Both are copies of something this
server knows and, since B608, publishes.

## Work

In `fernscout-helper`:

- Fetch and cache `<site>/content-model.json` using the existing `api.mjs`
  machinery, which B579 already hardened: cached a day, an unrecognised **or
  unparseable** document treated as stale and refetched, `--refresh`
  refetches, `--offline` uses the cache and says so.
- Add the interpreter for the eight `assert` kinds. **It never evaluates
  anything** — no expressions, no code. `pattern` is anchored, length-capped
  and matched with a linear-time matcher or not at all. The document comes
  from whatever `FERNSCOUT_URL` names and is used to inspect somebody's
  private journal.
- Keep `model.mjs` as a fallback and **report which source was used**.
- The edges matter more than the happy path. Each of these is reported by
  name, never skipped silently:
  - an `assert` kind the interpreter does not know
  - a `named` check the client has not implemented
  - a major version it does not understand → refuse and say so
  - no manifest at all (older instance) → file-shape checks only, and say
    which run you got

Not doing: removing `model.mjs` or moving rules across — that is B610.

## Acceptance

- The three fixture journals produce **identical findings** whether validating
  from the manifest or from `model.mjs`, and the report names which it used.
- A manifest carrying an unknown `assert` kind, an unimplemented `named`
  check, or a future major version each produce a named report line, proven
  by a test for each.
- `selftest.mjs` passes against a live instance.
- Nothing a user sees changes.
