---
id: B585
title: model.mjs still says coordinates and photos are only ever false, and the site has a third answer
type: ISSUE
priority: medium
complexity: low
area: fernscout-helper, model.mjs, drift
found: "2026-09-06T14:17:36Z"
started: "2026-09-06T18:00:10Z"
merged: "2026-09-06T18:12:32Z"
completed: "2026-09-07T13:12:15Z"
---

# B585 — model.mjs still says coordinates and photos are only ever false, and the site has a third answer

## Why

Found on 2026-09-06 while building B581, and it is the drift `selftest.mjs`
exists for — arriving by the one route `selftest.mjs` cannot see.

`shared/model.mjs:144-145`:

    coordinates: { apiOnly: true, note: "only ever false — this day has no one place" },
    photos:      { apiOnly: true, note: "only ever false — this day has no photographs" },

The instance's own contract disagrees. From `<site>/openapi.json`, the `Draft`
schema:

    coordinates → type: ["boolean", "string"]
    photos      → type: ["boolean", "string"]
    costs       → type: ["array", "boolean", "string"]

and each description carries the same third answer:

> `"unknown"` is the third answer: there are pictures somewhere and nobody has
> them to hand. They can be added later; the day does not have to wait.

So all three fields take `"unknown"`, not just `costs`. `costs` was taught this
when `unrecorded: [costs]` was added — the incident `AGENTS.md` tells the whole
story of. `coordinates` and `photos` gained the same third answer and these
notes were never updated.

**Nothing is broken today**, and that is worth being precise about. `note:` is
prose for a reader; it carries no type or enum, so nothing refuses
`unrecorded: [photos]` — B581 confirmed a day carrying it behaves correctly all
the way through. What is wrong is that an agent reading `model.mjs` to find out
what a day may say is told that "there were some and they are gone" is not
sayable about photographs. That is how a person gets asked to choose between
two wrong answers, or gets a `without: [photos]` — *there were none* — written
over a day that simply has no pictures to hand.

**Why the self-test did not catch it.** `luecken` and `perfekt` are validated,
and validation skips `apiOnly` keys entirely (`validate.mjs:126`). These three
are `apiOnly`. So the fixtures cannot reach them, and the guard against exactly
this kind of drift has a blind spot precisely where the drift happened. That is
the more interesting half of this finding.

Related: B573 (weather, also `apiOnly`, also invisible to the fixtures).

## Work

- Correct both notes to name all the answers the schema takes, in the shape
  `costs`'s note already uses — it is the one that got this right.
- Then the blind spot. Something has to compare `model.mjs` against the
  instance's schema for keys the fixtures cannot exercise. `selftest.mjs` is
  already the place where these tools are checked against a live contract; a
  pass that walks the `apiOnly` keys and reports where the model's shape and
  the schema's type disagree would have caught this the day it happened. It
  cannot check prose — but a note saying "only ever false" beside a schema
  saying `["boolean","string"]` is a type disagreement, not a wording one.
- If that comparison is too loose to be a pass/fail, make it a printed report
  rather than nothing.

Not doing: making `apiOnly` keys validatable in journal files. They are
request-only for good reasons (B573 covers the one exception worth offering).

## Acceptance

- `model.mjs` describes the three answers for `coordinates` and `photos`.
- `selftest.mjs` — or something it runs — reports a disagreement between an
  `apiOnly` key's declared shape and the instance's schema, demonstrated by
  reverting one note/type and watching it be named.
- A day carrying `unrecorded: [photos]` still validates and publishes (it does
  today; assert it so it keeps doing so).
