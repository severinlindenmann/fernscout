---
id: B613
title: The guide says an unknown caption src is ignored; it is refused
type: ISSUE
priority: low
complexity: low
area: agent guide
superseded: "fixed by B612 — the guide now says an unknown caption src is refused"
found: "2026-09-06T15:20:00Z"
---

# B613 — The guide says an unknown caption src is ignored; it is refused

## Why

`/agent.md`, in "Photographs and video":

> An empty string removes a caption; a `src` the day does not carry is
> **ignored**.

It is refused, with a `400` naming the field. B540 changed that on purpose —
before it, `spliceCaptions` found nothing to rewrite for a name it did not
recognise, answered `200` with `changed: ["captions"]`, and wrote nothing, so a
typo in the one argument the field takes looked exactly like success. The
behaviour was fixed and the sentence was not.

Proved against a running instance:

```
PATCH .../days/<slug>  {"captions": {".../99.jpg": "nope"}}
→ 400 invalid_entry, problems[0].expected =
  "a src this day's gallery actually has — see the gallery in GET .../days/<slug>"
```

Cost: an agent that reads "ignored" and gets a `400` concludes it has
misunderstood the shape of the field, not that it mistyped one key. The
docblock on `EditInput.captions` in `lib/api/entries.ts` says "ignored rather
than added" too, and is wrong in the same way.

## Work

Fix the sentence in `lib/api/documentation.ts`, and the two docblocks in
`lib/api/entries.ts` that say the same thing. Nothing about the behaviour
changes — `checkCaptions` is right and B540's reasoning stands.

Being fixed inside B612, which rewrites the end of that same paragraph.

## Acceptance

- `/agent.md` says an unknown `src` is refused, not ignored.
- No comment in `lib/api/` still claims a caption key is ignored.

## Triage 2026-09-07

Checked against current code during the backlog cleanup: lib/api/documentation.ts now states that an unknown caption src is refused, not ignored. B612 landed it and sits in testing/.
