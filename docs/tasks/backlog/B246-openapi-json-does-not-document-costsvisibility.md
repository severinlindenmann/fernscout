---
id: B246
title: openapi.json does not document costsVisibility on POST trips
type: ISSUE
priority: low
complexity: low
area: api, docs
found: "2026-09-04T09:05:06Z"
---

# B246 — openapi.json does not document costsVisibility on POST trips

## Why

Noticed while adding `people`, `rates` and `translations` to the same object
for B207. `POST /api/v1/{user}/trips` in `app/openapi.json/route.ts` lists
`id`, `title`, `start`, `end`, `tagline`, `status`, `accent`, `visibility`,
`listed`, `test`, `intro` and now the three B207 fields. It does not list
`costsVisibility`, which B178 added to both doors and which `/agent.md`
describes at length.

`/openapi.json` is the machine contract — `/documentation.txt` points at it,
and a client generating a request from it cannot ask for guests-only money.
That is the exact failure B178 fixed, surviving in the one place a program
reads rather than a person.

Not fixed inside B207 on purpose: it is a second problem found while building,
and absorbing it would have hidden it.

## Work

- Add `costsVisibility` to that `properties` object, with the enum
  `["public", "guests"]` and the sentence `/agent.md` already uses — it is not
  `visibility`, it decides only whether the numbers are drawn.
- While there, check the rest of the document against the routes rather than
  only this one field: `test/` has no assertion that openapi's request bodies
  match what the handlers read, and this gap says one is worth having.

## Acceptance

- `curl -s localhost:3000/openapi.json | jq '.paths["/api/v1/{user}/trips"].post.requestBody.content["application/json"].schema.properties | keys'`
  includes `costsVisibility`.
- A test fails if a field either door accepts is missing from the document, or
  the reason there is no such test is written down here.
