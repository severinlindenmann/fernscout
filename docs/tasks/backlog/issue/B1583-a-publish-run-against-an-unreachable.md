---
id: B1583
title: A publish run against an unreachable instance dies with a raw Node stack trace instead of a sentence
type: ISSUE
priority: low
complexity: low
area: fernscout-helper, shared/api.mjs
found: "2026-09-12T11:14:52Z"
---

# B1583 — A publish run against an unreachable instance dies with a raw Node stack trace instead of a sentence

## Why

Found while driving B1582, and pre-existing — the same thing happens with that
branch stashed.

`call()` in `.claude/skills/shared/api.mjs` does `await fetch(...)` with
nothing around it, so a host that is not listening rejects and the rejection
reaches the top of the script:

```
node:internal/modules/run_main:107
    triggerUncaughtException(
[TypeError: fetch failed] {
  [cause]: AggregateError [ECONNREFUSED]: …
      at internalConnectMultiple (node:net:1426:18)
```

Every other refusal in this repository is a sentence. `refuse()` renders an
API refusal with the field and the hint; `health()` says *"Could not reach
&lt;site&gt; and have no usable cached copy"*; the missing-token message prints
the whole six-digit code flow. This one path prints a Node internals stack
trace, and the two things a person most needs from it — **which URL**, and
**that the URL is the problem rather than their journal** — are the two things
it does not say.

The likeliest way to reach it is the most ordinary mistake there is: a typo in
`FERNSCOUT_URL`, an instance that is not running yet, a laptop off the
network. `call()` is reached on every run, so the blast radius is every skill
that talks to an instance, not only `publish`.

## Work

Catch the network failure in `call()` and return the same `{ status, ok, body }`
shape the rest of the code already branches on — `status: 0` with an `error` of
`unreachable` and the URL in the message — so `refuse()` renders it like any
other refusal and no caller needs a second code path. `health()`'s own wording
is the tone to copy.

Check what the callers then do with a `status: 0`: `publish.mjs` treats
`status === 404 || status === 401` as "create the journal", and an unreachable
server must not fall into that branch and start asking for a signup code.

## Acceptance

- `FERNSCOUT_URL` pointing at a dead port ends a `publish` run with a sentence
  naming the URL, and a non-zero exit, and no stack trace.
- A genuinely missing journal still reaches the create-a-journal path, which an
  unreachable server does not.
- The other skills that call `call()` behave the same way, since the fix is in
  the shared function rather than in `publish`.
