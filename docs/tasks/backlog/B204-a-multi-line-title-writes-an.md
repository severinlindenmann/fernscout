---
id: B204
title: A multi-line title writes an unreadable trip.md, keeps the id and leaves nothing able to remove it
type: ISSUE
priority: high
complexity: low
area: api, trips, validation
found: "2026-09-04"
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

## Cleanup outstanding

`/var/lib/fernscout/content/xydhd-qa5/trips/b83-broken/` exists on the deployed
server from this discovery, and can only be removed with shell access. It is
also a ready-made fixture for B83's owner-notice check, so it is worth keeping
until B83 is closed.
