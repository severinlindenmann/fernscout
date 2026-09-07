---
id: B678
title: The helper re-implements the file-shape rules, so a journal is judged by a copy of them
type: FEATURE
priority: medium
complexity: high
area: api, validation, helper-boundary
found: "2026-09-07T09:15:13Z"
---

# B678 — The helper re-implements the file-shape rules, so a journal is judged by a copy of them

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

`fernscout-helper` checks a journal on disk before sending it, and to do that
it re-implements this repository's rules: `contentModel.mjs` (635 lines),
`pattern.mjs` (342), and the half of `validate.mjs` (745) that walks keys,
types, enums and required lists. It is careful work — the model itself is
fetched from `<site>/content-model.json` rather than hand-kept, which was
B610's fix for exactly this drift — but the *matching* is still a second
implementation of `lib/validate/`.

Two implementations of one rule disagree. It has already happened once: the
site gained a third answer for a day whose costs nobody recorded and the helper
did not know the key, so a perfectly good journal came back with two errors,
both wrong. The model being published fixed the vocabulary; it did not fix the
fact that something else decides what the vocabulary *means*.

And it is the wrong side of the line B671 drew: **if a thing can run on the
server, it runs on the server.** Judging whether a day is well-formed needs the
day, not the disk.

## Work

**`POST /api/v1/<user>/validate`** — takes what is about to be written and
answers with what is wrong with it, without writing anything:

```json
{ "trip": { …trip.md frontmatter… },
  "days": [ { …entry frontmatter…, "slug": "…" } ],
  "costs": { … } }
```

Answers in the vocabulary the write routes already use — `problems[]` with
field, what arrived, what was expected — plus the `tips` the helper has and the
API does not: an option that exists and is not set. Same code path as the write
routes, `lib/validate/entry.ts` and its siblings, so a thing that validates
here is a thing that will be accepted there. That is the property worth having
and the one two implementations cannot promise.

**Then the helper loses the mirror**: `pattern.mjs` outright, most of
`contentModel.mjs`, and every key/type/enum check in `validate.mjs`. What stays
is what needs the disk and only the disk — a `gallery:` `src` that is not
there, a `media/<slug>/` folder belonging to no day, a filename's date against
the frontmatter's, two files sharing a slug, a date inside the trip with no
day at all. Those are real checks and no server can make them.

**Not doing**: validating media bytes (the upload route already answers that),
and any writing. This route reports.

## Acceptance

- `POST …/validate` with a well-formed trip and days answers with no problems;
  the same content sent to the write routes is accepted.
- A day with a bad enum, a missing required field and an unknown key comes back
  with all three at once, in the same shape a write refusal uses.
- Tips are separable from problems — a caller can render "will be refused"
  apart from "you have not set this".
- The helper's `validate-content` runs against it and no longer imports
  `pattern.mjs`; the file is deleted.
- `/openapi.json` documents it; `/agent.md` says when to call it.
- `npm run verify` and `npm run unused` pass.
