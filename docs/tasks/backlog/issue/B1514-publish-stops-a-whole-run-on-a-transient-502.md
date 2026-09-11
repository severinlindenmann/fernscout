---
id: B1514
title: publish stops a whole run on a transient 502 from a media upload
type: ISSUE
priority: low
complexity: low
area: helper, publish
found: "2026-09-11T19:12:00Z"
---

# B1514 — publish stops a whole run on a transient 502 from a media upload

## Why

Hit live on 2026-09-11, three days into a 23-day publish:

```
✗ POST …/media (park-glasbode-und-wat-pho)
      502 refused
Nothing further was sent. Fix the above and run again — what already landed stays.
```

Re-running finished the job with no other change, which is the tell: there was
nothing to fix. A `502` from a gateway is not a refusal — nothing was wrong with
the request, the body, or the file.

**Stopping at the first refusal is the right default and should stay.** A `400`
naming a field, a `409` on a slug, a `422` on an incomplete day — every one of
those means the next call would be wrong too, and the run's own message
("run again, what already landed stays") is what makes that safe rather than
frightening. This ticket is not about weakening that.

It is about one distinction the run does not draw: a refusal that says *your
request is wrong* versus one that says *ask again*. The second category is
small and well known — `502`, `503`, `504`, and a connection reset — and every
one of them is answered by trying the same call a second time.

The cost of not drawing it is paid in bandwidth: a trip with a few hundred
photographs re-reads what the instance already holds on the next run, and a
person has to be there to type the command again.

## Work

Retry only on `502`, `503`, `504` and a network-level failure: two further
attempts, a short backoff, and a printed line each time so a retry is never
invisible. Everything else keeps the current behaviour exactly.

A media upload is the safe place to start: it is the call that takes the longest
and the one the instance deduplicates by itself, so a retried batch cannot
double anything.

## Acceptance

- A `502` on a media batch is retried, with a line saying so, and the run
  continues.
- A `400`, `409` or `422` still stops the run at once, unchanged.
- A retry that also fails stops with the same message as today.
