---
id: B1720
title: The v2 contract declares no path parameters, so a generated client cannot fill {user} or {trip}
type: ISSUE
priority: medium
complexity: medium
area: api v2, contract
found: "2026-09-14T10:01:23Z"
started: "2026-09-14T13:12:52Z"
session: 3309c078-d934-4ee7-ad04-6cd719fc543a
claimed: "2026-09-14T13:12:52Z"
---

# B1720 — The v2 contract declares no path parameters, so a generated client cannot fill {user} or {trip}

## Why

Found while fixing B1714, and left for its own ticket because it predates that
branch.

Every templated path in `/api/v2/openapi.json` — `{user}`, `{trip}`, `{slug}`,
`{id}`, `{src}` — is declared in the path string and nowhere else. OpenAPI 3.1
requires a `parameters` entry (`in: "path"`, `required: true`, with a schema)
for each hole, and `lib/api/v2/openapi.ts` emits none: an operation is
`{summary, requestBody, responses}`.

```
$ npx @redocly/cli lint /tmp/v2-openapi.json
error   path-parameters-defined: 100
```

The document still passes a pure JSON-Schema validation of 3.1 (the
`parameters` array is optional in the schema; the requirement is in the
specification's prose), which is why nothing has caught it. What it costs is
the case the contract exists for: a generated client has no type, no
description and no constraint for the values it must substitute, so it cannot
build a URL from the document alone — it has to be told out of band what a
`{user}` is. v1's hand-written `lib/api/openapi.ts` declares them.

## Work

- Emit a `parameters` array per path item (they are the same for every verb on
  a path, and 3.1 allows declaring them once on the item rather than per
  operation).
- Derive them from the path string rather than typing them per route, so a
  new templated segment cannot arrive undeclared.
- Give each a schema and one sentence: what a username is, what a trip id is,
  what a day slug is — the vocabulary is already in `lib/users.ts` and
  `lib/trips.ts`.
- A test that every `{hole}` in every path has a declared parameter.

## Acceptance

- `npx @redocly/cli lint` reports no `path-parameters-defined` error.
- A generated client can fill every path from the document alone.
