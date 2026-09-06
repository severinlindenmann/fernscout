---
id: B609
title: The helper copies the file shape instead of reading it from the instance
type: FEATURE
priority: high
complexity: medium
area: fernscout-helper, validate-content, content model
found: "2026-09-06T15:11:52Z"
started: "2026-09-06T16:04:25Z"
merged: "2026-09-06T16:16:52Z"
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

---

## Sent back from testing, 2026-09-06

**It did not hold up against the real document.** Merged, then reverted on
`fernscout-helper` main (revert of merge `cf3c23c`) about an hour later, when
B608 was deployed and `https://fernscout.ch/content-model.json` became
fetchable for the first time.

Reading the live document, the helper reported **203 errors on a journal that
has none** — `title is not a field`, `date is not a field`, and so on for
essentially every key. The `known-key` rule's key list was never found, so
every key read as unknown.

The cause is a wire-format disagreement. The two halves were built in parallel
against W41 rather than against each other, and settled on different shapes:

| | top level | where a rule lives |
| --- | --- | --- |
| B608, published | `contentModel, files, rules[], named[]` | a flat array; each rule carries `where`, `path`, `assert` |
| B609, as merged | `contentModel, files, shapes` | nested inside `files[x].keys[k].asserts[]` |

**B608's shape is the authority.** It is what W41's own worked example shows,
it is what is deployed, and a client is the side that adapts to a published
contract.

**The deeper fault is in how this was accepted, not in the interpreter.** The
acceptance line "the three fixture journals produce identical findings from
either source" was demonstrated against a fixture manifest *this ticket wrote
itself*. A client that agrees with its own idea of the document proves
nothing. The whole point of W41 is that one side publishes and the other
follows; a test where the follower writes both halves cannot see a divergence.

That the helper's own `selftest.mjs` caught this within seconds of the deploy
is the design working — B577 made it able to say anything at all, and this is
the first time it has caught something real.

## Work, second attempt

- Read the shape `content-model.json` actually publishes: a flat `rules[]`,
  each with `where`, `path`, `assert` and the kind's own fields (`keys` for
  `known-key`, `values` for `enum`, `pattern`/`expected` for `pattern`), plus
  `named[]`. Do not change the published document to match the client.
- Keep everything else from the first attempt: it was sound. `pattern.mjs` in
  particular is worth keeping intact — it matches `^(a+)+$` against 20,000
  characters in 5ms where `RegExp` takes 96 seconds on 40, and refuses
  lookaround, backreferences, unanchored patterns and oversized repeat counts
  by name.
- **Replace the acceptance evidence.** The identical-findings comparison must
  run against the document fetched from a real instance — `fernscout.ch` now
  serves it — not against a fixture written by this ticket. A self-written
  fixture may stay as an offline convenience, but it cannot be what the
  acceptance rests on.
- Add the case that would have caught this: a document whose shape the client
  cannot read must report that by name and fall back, exactly as an unknown
  assert kind already does. "Fetched, parsed, and understood as nothing" is
  currently indistinguishable from "understood".

## Acceptance, second attempt

- Validating `content/severin` against the **live** `fernscout.ch` document
  gives the same findings as `model.mjs`: 0 errors, 0 warnings.
- `selftest.mjs` passes against the live instance, with the manifest as the
  source — perfekt 0/0, halbfertig 0/0, luecken at least 24.
- The report names which source it used, and says so for the live document.
- A structurally unreadable document is reported by name and falls back,
  proven by a test.
