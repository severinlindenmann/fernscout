---
id: B204
title: A multi-line title writes an unreadable trip.md, keeps the id and leaves nothing able to remove it
type: ISSUE
priority: high
complexity: low
area: api, trips, validation
found: "2026-09-04"
started: "2026-09-04T05:58:32Z"
merged: "2026-09-04T06:20:33Z"
---

# B204 — A title can brick a trip id through the documented API

## Why

Found while verifying B83 on the live instance, by an agent trying to seed a
malformed trip and discovering the write path would do it for free.

`q()` in `lib/tripWrite.ts:183` escapes `"` and `\` when quoting a frontmatter
scalar. It does not escape or reject **newlines**. So a title containing
`\n---\n` closes the frontmatter block from inside the value:

```
POST /api/v1/<user>/trips
{"id":"b83-broken","title":"B83 QA broken trip\n---\nnot: [yaml", …}
-> 400 {"error":"trip_unreadable",
        "message":"The trip was written but does not read back.
                   This is a bug; please report it."}
```

On disk afterwards:

```yaml
---
id: b83-broken
title: "B83 QA broken trip
---
```

The read-back guard at `lib/tripWrite.ts:199-216` correctly notices the file
does not parse and correctly refuses — **and then leaves the folder there.**
There is no rollback.

What that costs, in order:

- **The id is now taken.** A retry answers `409 trip_exists`.
- **Nothing can remove it.** Every delete path resolves the trip first, and
  this trip does not read, so `DELETE /api/v1/<user>/trips/<trip>` cannot find
  it. The MCP door is the same.
- **So an agent has permanently consumed one of its owner's trip ids** with a
  single call to a documented endpoint, and recovery needs shell access to
  `/var/lib/fernscout/content/` — which is exactly the thing this product tells
  people they will never need.

The blast radius is small but the shape is bad: the failure is caused by
ordinary input, the error message says "this is a bug; please report it" while
giving no way to clean up, and the only person who can fix it is whoever can
`rm -rf` on the server.

B83 is what makes this survivable rather than invisible — the malformed folder
now shows in the owner's `/trips` notice and in `GET /api/v1/<user>/trips`'s
`malformed` array, so at least the writer can see what it did. That is a good
argument for B83 and not a reason to leave this.

## What was built

The Why above is accurate; nothing in it needed correcting. Two findings while
building it are recorded at the end of this section.

- **`lib/validate/frontmatter.ts`** is new and holds the two halves:
  `quoteScalar`, which escapes newlines, tabs and the remaining control
  characters as well as `"` and `\\`, and `singleLineProblem`, which names a
  field that cannot be a one-line scalar. Pure, like the rest of
  `lib/validate`, and shared rather than copied — the duplicate `q()` and
  `quote()` were wrong in the same way because they were two copies.
- **`createTrip` refuses a multi-line `title` or `tagline`** before anything
  is written, with `invalid_title` / `invalid_tagline`. `intro` is deliberately
  not checked: it is prose below the closing `---` and multiple lines are the
  point.
- **A failed read-back rolls the folder back.** Safe because the `existsSync`
  guard above it answers `trip_exists` when the directory already exists, so
  by the time the rollback runs the folder is one this call made. The message
  now says the id is still free, or — if the removal itself failed — that it is
  not.
- **The day writer's `quote()` is now `quoteScalar`.** It had the identical
  hazard on `location`, `country`, `transportFrom`/`To`, `tags` and cost
  labels, none of which is checked for line breaks.

`costs.md` and `plan.md` have **no writer at all** — nothing in `lib/` or
`app/` writes either, they are hand-written by the `add-a-trip` skill — so
there was no third copy of the pattern to fix.

Two things noticed and captured rather than absorbed:

- **B208** — `createDraft` never reads its entry back, so the trip path fails
  loudly on a file that does not parse and the day path would answer 201 over
  one. With `quoteScalar` in place there is no known input that reaches it,
  which is why it is a capture and not part of this.
- **B206** — MCP `create_trip` has no `listed` property while REST does. Found
  while checking that both doors accept the same body.

## Work

Three things, and the first two are independent of each other:

- **Reject the input.** A title or tagline containing a newline should answer
  `400` naming the field, before anything is written. Frontmatter scalars are
  single-line by construction; there is no legitimate multi-line title.
- **Roll back a failed write.** When the read-back guard fires, remove the
  folder it just created before returning, so a failed create leaves nothing
  and the id stays free. Guard the removal so it can only ever delete a folder
  this call made — never one that already existed.
- Make `q()` escape newlines regardless, as a belt-and-braces measure. Even
  with validation in front, a quoting helper that can produce invalid YAML from
  a string is a hazard for the next caller.

Check `costs.md` and `plan.md` writers, and the day-entry writer, for the same
pattern — anywhere a caller-supplied string reaches a quoted scalar.

Not doing: a general "repair a broken trip" endpoint. That is B83's territory
and a bigger question; this task is about not creating the breakage.

## Acceptance

- `POST /api/v1/<user>/trips` with a newline in `title` or `tagline` answers
  `400` naming the field, and writes nothing.
- A create that fails its read-back for any reason leaves no folder behind, and
  the id can be used again immediately.
- The same through MCP `create_trip`.
- A test sends `"a\n---\nb"` as a title and asserts both — the refusal, and that
  the trips directory is unchanged afterwards.

### Evidence

All four verified, each by a test that fails with the fix removed
(demonstrated by disabling the validation and the rollback and re-running:
four failures, all four green with them back).

- `test/journals.test.ts` → "a value that would break out of the frontmatter":
  the refusal names `title`, the trips directory is byte-for-byte the list it
  was, and the id is reusable on the next call.
- Same describe → "a multi-line tagline is refused the same way".
- `test/journals.test.ts` → "a create that fails its read-back leaves no folder
  behind": `getTrip` is stubbed to refuse the new ref, so the rollback branch
  is exercised rather than argued about; the folder is gone and the message
  says the id is free.
- `test/mcp.test.ts` → "a title that would break the frontmatter is refused and
  leaves no folder": the same call through the other door, plus a second
  `create_trip` on the same id succeeding.

## Cleanup outstanding

`/var/lib/fernscout/content/xydhd-qa5/trips/b83-broken/` exists on the deployed
server from this discovery, and can only be removed with shell access. It is
also a ready-made fixture for B83's owner-notice check, so it is worth keeping
until B83 is closed.
