---
id: B568
title: A refusal echoes back a value of any size
type: ISSUE
priority: low
complexity: low
area: api, validation
found: "2026-09-06T21:10:00Z"
started: "2026-09-06T11:10:51Z"
merged: "2026-09-06T11:16:51Z"
---

# B568 — A refusal echoes back a value of any size

## Why

From the security pass over B535/B540/B553/B560, which found nothing blocking
and this one thing worth writing down.

`describe()` (`lib/validate/entry.ts`) is `JSON.stringify` with no ceiling, and
its result goes into the `got` field of every problem. So a caller can send a
misspelled key with a multi-megabyte string under it and have the whole thing
reflected back:

    POST .../trips  {"visibilty": "<10 MB of text>"}
    → 400, and 10 MB of it comes back

Safe — it is JSON in a JSON body, never HTML, a log line or a mail, and the
reviewer traced that. It is a free doubling of an oversized request, and it
predates this work rather than arriving with it.

The reason to fix it is not really the bandwidth. **A refusal is something an
agent reads**, and one carrying ten megabytes of the caller's own text is
unreadable by exactly the weak model these messages were rewritten for. The
useful part of `got` is its first line.

## Work

Cap `describe()` — a few hundred characters and an ellipsis saying how much was
cut. It is used by every validator in `lib/validate/`, so one change covers the
whole surface. Keep the shape recognisable: the point of `got` is that a reader
can see *what arrived*, and a truncated string still shows that.

## Acceptance

- A 1 MB value in a refused field comes back truncated, with the length named.
- A short value is unchanged, including the quotes that distinguish `"12"`
  from `12`.
- `npm run verify` green.
