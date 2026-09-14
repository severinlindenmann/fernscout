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

## Done, 2026-09-14

Changed:
- `lib/api/v2/openapi.ts` — added a `PATH_PARAMETERS` vocabulary keyed by hole
  name (`user`, `trip`, `slug`, `id`, `src`, `path`), a `parametersFor(path)`
  function that walks the path string with `/\{([^}]+)\}/g` and emits an
  OpenAPI `parameters` entry for every hole (falling back to a bare
  `{type: "string", minLength: 1}` schema and no description for a name with
  no vocabulary entry, rather than throwing), and a loop at the end of
  `buildPaths()` that attaches `item.parameters` once per path item (3.1
  allows declaring parameters at the item level since every verb on a path
  shares the same holes). Patterns are read from source of truth rather than
  retyped: `USERNAME_RE` (`lib/users.ts`), `ID_RE` (`lib/tripWrite.ts`), and
  `daySlug` (`lib/api/v2/schemas/day.ts`).
- `lib/users.ts` — exported `USERNAME_RE` so the contract states the same
  pattern the server resolves with.
- `test/openapi-v2-contract.test.ts` — added a structural test asserting
  every path hole has a declared parameter, every declared parameter names a
  hole the path actually has, and each is `in: "path"`, `required: true`,
  carries a `schema` and a `description`. Existing tests that iterate "the
  operations on a path item" were updated to filter out the new
  `parameters` key via `operationEntries()` so it doesn't read as a sixth,
  bodyless verb.

Verify (foreground, `VERIFY_WILL_WAIT=1 npm run verify`): all 5 gates green —
build, typecheck, lint, vitest (605 files / 7730 passed, 4 skipped), knip.

Red-gate proof: temporarily removed the `trip:` entry from
`PATH_PARAMETERS` and ran `npx vitest run test/openapi-v2-contract.test.ts`.
The new test failed as expected (10 `{trip}` parameters left with no
description, since the fallback schema still applies but the vocabulary
description does not):

```
FAIL  test/openapi-v2-contract.test.ts > the v2 openapi document covers every route on disk > every path hole has a declared parameter, and no declared parameter names a hole the path lacks
AssertionError: declared parameters missing in/required/schema/description:
/api/v2/{user}/trips/{trip} — {trip} has no description
/api/v2/{user}/trips/{trip}/days — {trip} has no description
/api/v2/{user}/trips/{trip}/days/{slug} — {trip} has no description
/api/v2/{user}/trips/{trip}/days/{slug}/media — {trip} has no description
/api/v2/{user}/trips/{trip}/days/{slug}/publish — {trip} has no description
/api/v2/{user}/trips/{trip}/days/{slug}/unpublish — {trip} has no description
/api/v2/{user}/trips/{trip}/days/{slug}/send — {trip} has no description
/api/v2/{user}/trips/{trip}/costs/apply — {trip} has no description
/api/v2/{user}/trips/{trip}/media/duplicates — {trip} has no description
/api/v2/{user}/trips/{trip}/travellers/from-photo — {trip} has no description

Tests  1 failed | 80 passed (81)
```

The `trip:` entry was restored immediately after; `git diff --stat` matches
the state before this check (159 insertions across the three files).
