---
id: B1734
title: The v2 contract documents no way to sign in, so /openapi.json cannot be retired
type: ISSUE
priority: medium
complexity: medium
area: api v2, contract
found: "2026-09-14T12:03:19Z"
---

# B1734 — The v2 contract documents no way to sign in, so /openapi.json cannot be retired

## Why

An audit asked why `/content-model.json` was retired with a 410 and
`/openapi.json` still answers 200 with `info.version: 1`. Measured:

```
$ curl -s -o /dev/null -w '%{http_code}\n' https://fernscout.ch/openapi.json
200
$ curl -s https://fernscout.ch/openapi.json | jq '.info.version, (.paths|length)'
1
13
```

The answer is that the two documents are not the same kind of stale.
`/content-model.json` described a file shape the instance had stopped
accepting — it was wrong. `/openapi.json` is **the only published contract for
`/api/auth/**`**, which is not v1 at all: it is the current and only way any
client signs in. Its thirteen paths are the six auth doors, the two surviving
v1 routes (`track`, `deletions/{token}`), `/api/health` and the markdown twins.

```
$ curl -s https://fernscout.ch/api/v2/openapi.json | jq '[.paths|keys[]|select(startswith("/api/auth"))]|length'
0
```

So retiring it today would leave a client able to read every write door and no
way to obtain the token they all require. That is worse than the trap it
currently is.

**The trap is real too**: a client discovering `/openapi.json` gets a valid
document titled "Fernscout API" announcing version 1, and fernscout-helper
cached exactly that and reported success while every route it called answered
404 (B1715). Its own fix was to require `info.version === 2` — which only works
because there is a second document to require.

## Work

- Put the auth surface into the v2 document, generated from
  `lib/api/v2/schemas/auth.ts` the way every other v2 operation is. It is
  already the schema those routes parse with.
- Then `/openapi.json` has two surviving v1 routes left in it and can be
  retired the way `/content-model.json` was — a 410 naming its replacement.
- Until then, the v1 document must not read as *the* contract: its `info.title`
  and `description` should say what it is and point at `/api/v2/openapi.json`.

## Acceptance

- A client can sign in using `/api/v2/openapi.json` alone.
- `/openapi.json` either 410s naming its replacement, or says in its own title
  that it is not the API's contract.
