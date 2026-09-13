---
id: B1648
title: openapi.json day write schema omits status from required though the server demands it
type: ISSUE
priority: low
complexity: low
area: API v2
found: "2026-09-13T08:38:31Z"
---

# B1648 — openapi.json day write schema omits status from required though the server demands it

## Why

`/api/v2/openapi.json`'s schema for
`PUT /api/v2/{user}/trips/{trip}/days/{slug}` (and the matching `PATCH`) lists
`required: ["slug", "title", "date", "content"]` on the request body — `status`
is an optional property (`{"type": "string", "const": "draft"}`).

That is not what the live server does. Sending a day with every field the
schema calls required, and no `status` and no `declined.status`, is refused
live (`fernscout.ch`, commit `07345e79`):

```json
{"error":"incomplete","message":"...","details":{"missing":[{"field":"status", ...}]}}
```

An agent following only the served contract — which is the point of phase 3,
and the stated situation for any caller of this API per AGENTS.md — has no way
to predict this from the schema alone; it has to hit the 422 first. This is
the same class of gap `keep-the-contract` exists to catch: the words (schema)
say one thing, the code enforces another.

## Work

Either add `status` to the schema's `required` array (since it is, in
practice, asked-or-declined the same as every other field the `incomplete`
check enumerates), or — if the intent is genuinely optional with a silent
default — make the runtime check match the schema instead. Whichever is
correct, the two need to agree; `test/openapi-contract.test.ts` did not catch
this because it checks documentation completeness, not runtime behaviour
against the schema's own `required` list.

## Acceptance

A day `PUT` with every schema-required field and nothing else either succeeds,
or the schema's `required` list names everything the server actually demands.
