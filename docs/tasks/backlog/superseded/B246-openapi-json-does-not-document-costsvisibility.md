---
id: B246
title: openapi.json does not document costsVisibility on POST trips
type: ISSUE
priority: low
complexity: low
area: api, docs
found: "2026-09-04T09:05:06Z"
superseded: "B540 — costsVisibility is documented, and a test now fails on any accepted field that is not"
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

## Overtaken by B540

`costsVisibility` is in the `POST .../trips` schema, with the sentence B178
wrote about who may see a trip's money and why this call is the only way an
owner reaches it. Two of the fields listed above turned out to be worse than
undocumented — `tracks` was accepted and silently dropped, and so was
`countryCode` on a day — which is what B540 went looking for once this class of
bug was taken seriously.

The general form is fixed too, which is why this is superseded rather than
merely done: `test/openapi-contract.test.ts` fails on an enum that has drifted
from the constant that validates it, and `test/contract-roundtrip.test.ts`
fails on a documented field that cannot be written and read back. A field
accepted by the code and missing from the document is now a broken build
rather than something to notice while doing something else.
