---
id: B535
title: A write route silently drops every field it does not recognise
type: FEATURE
priority: high
complexity: high
area: api, validation, openapi
found: "2026-09-06T12:10:00Z"
started: "2026-09-06T08:05:42Z"
session: 73b1a7f5-30ec-425d-9dbf-4d423e411c0d
claimed: "2026-09-06T08:05:42Z"
---

# B535 — A write route silently drops every field it does not recognise

## Why

`POST /api/v1/<user>/trips` reads its body as `Record<string, unknown>` and
picks out the keys it knows (`app/api/v1/[user]/trips/route.ts:87`). `POST
.../days` validates the fields it knows about and never looks at the ones it
does not (`lib/validate/entry.ts` — there is no `Object.keys` check in the
file). So:

    POST .../trips  { "visibilty": "guest", ... }   →  201 Created

The trip is created `public`, the caller is told it succeeded, and nothing
anywhere records that a field was thrown away. The same holds for
`transport_mode` instead of `transportMode`, for `body` instead of `content`,
and for every field an agent invents because it seemed reasonable.

This is the other half of what B531 found. B531 is about a day missing
something **the trip is keeping track of** — an omission of substance. This is
about a field that **was sent and did not arrive** — an omission of shape. A
day written with `costs` misspelled is refused by neither today: B531's
contract sees no costs and asks for them, which is the right question asked
about the wrong thing, and a caller that fixes the "missing" costs by sending
them again under the same wrong key loops.

**The contract already exists and is not executed.** `lib/api/openapi.ts` is
1983 hand-written lines describing 18 request bodies, including
`components.schemas.Draft` with its `required` list and every property typed.
`/openapi.json` serves it, `/docs/api` renders it, and
`test/agent-interface.test.ts:663` already reaches into
`requestBody.content["application/json"].schema.properties` to assert what the
API promises. Nothing at runtime reads any of it. The published contract and
the enforced behaviour are two documents, and only one of them is checked.

None of this is fixed by changing the on-disk format. The failure is at the
JSON boundary, which is already JSON.

## Work

**One pure checker.** `lib/validate/body.ts`, alongside `entry.ts`,
`costs.ts`, `media.ts` — no fs, no `server-only`, same `Problem[]` shape they
already produce. `checkBody(body, schema)` returns `{ problems, warnings }`
and answers three questions the routes do not ask today:

- **unknown key** → a problem, with a suggestion when the key is within an
  edit or a case-fold of a known one (`visibilty` → `visibility`,
  `transport_mode` → `transportMode`). The suggestion is what makes the
  refusal actionable rather than merely correct.
- **wrong type** → a problem naming what arrived and what was expected, in the
  wording `describe()` (`lib/validate/entry.ts:126`) already uses.
- **missing required** → a problem, from the schema's own `required` list.

`warnings` exists for what must not fail: a field that is accepted but
deprecated, and — see below — a route whose schema is absent. Nothing silently
dropped in either direction.

**The schema is the OpenAPI document, not a second copy.** The checker takes a
plain schema object; the route passes
`openApiDocument().paths[...].<verb>.requestBody...schema`, resolving `$ref`
against `components.schemas`. A new field is then one edit to `openapi.ts` and
it is documented, rendered and enforced at once — which is the only version of
this that stays true. Memoise the document; it is built per call today.

Deliberately **not** a JSON Schema library. The subset in use here is
`type`, `properties`, `required`, `items`, `enum` and `$ref`, and ajv is a
dependency, a bundle and a class of error messages nobody here would have
written. A `ponytail:` comment naming the subset and ajv as the upgrade path.

**Built, first commit** — `lib/validate/body.ts` and its 21 tests, plus
`test/api-route-schemas.test.ts`. Three decisions the code made that the plan
above did not:

- **Top level only.** Unknown keys, `required`, and the type and `enum` of
  each top-level value. It does not descend into `costs[]` or
  `translations{}`: `validateEntry` already checks those in far better words,
  and two validators reporting one mistake twice reads as a bug in the API. A
  route with both runs both and drops any shape problem naming a field the
  specialised one already named — the one line is in the module's header.
- **An unresolvable `$ref` checks nothing** rather than refusing every field
  against an empty schema. One typo in `openapi.ts` would otherwise make a
  route that accepts no body at all.
- **`additionalProperties: true`** puts unknown keys in `warnings` instead of
  `problems`, for a route that genuinely takes free-form keys. Absent means
  `false` here, which is the opposite of JSON Schema's default and the whole
  point.

What the coverage test found: **11 of the 18** `/api/v1` routes that read a
body already publish a request schema. The other 7 are not merely missing a
body — they are absent from the document altogether, `.../people` and
`.../travellers` among them, both of which `AGENTS.md` sends agents to by
name. That list is in the test, and it is B536's.

**Two routes only, in this task** — `POST .../trips` and `POST .../days` —
because they are where the reported pain is and because proving the mechanism
on a route that already has a `problems[]` list (days) and one that has none
(trips) is what shows the shape is right. The other sixteen are B536.

**Ordering matters.** The body check runs *after* auth and after the
trip-exists check, never before: `app/api/v1/[user]/trips/[trip]/days/route.ts:96`
answers alike for a trip that does not exist and one that is not yours, and a
body error returned first would say which. A test for that, or this becomes a
way to enumerate a journal's trips.

**Compatibility.** The day route keeps answering `error: "invalid_entry"` with
its existing `problems` list — the guide, the skills and B531 all name it.
Shape problems are appended to that same list. Routes with no validator today
answer `error: "invalid_body"` with the same `problems` shape.

**A test that fails when a route has no schema.** Enumerate the `/api/v1`
routes that read a body — 18 today — and assert each has a `requestBody`
schema in `openapi.ts`. It fails now, and that failing list is B536's work
list. Until a route is wired, an absent schema is a `warnings` entry and never
a refusal: a doc bug must not take writes down.

Not doing: the `/api/auth/*` and `/api/contacts/*` routes (browser flows,
different threat model, own capture if wanted); response validation;
generating `openapi.ts` from anything.

## Acceptance

- `POST .../trips` with `visibilty` answers 400, names the field, and suggests
  `visibility`. The trip is not created.
- `POST .../days` with `transport_mode` answers 400 in the existing
  `invalid_entry` / `problems` shape, alongside any B531 contract problems.
- `lat: "46.5"` on a day is refused, naming string-where-number.
- A body error for a trip the token may not write to still answers 404, not
  400 — the ordering test.
- The route-has-a-schema test exists and lists the routes still uncovered.
- `npm run verify` green.

## Sequencing

Three worktrees are live in this area on 2026-09-06 and this task is written
to collide with none of them:

- **b531-day-contract** (B531/B532/B533) owns `lib/validate/entry.ts`, the day
  POST/PATCH, publish, and `tracks:` on trip create. Its task says explicitly
  it is *not* touching the shape checks — this is that half. It touches the
  same two route files, so the wiring lands **after B531 merges**.
- **b325-day-weather** adds a day field. A field that reaches `entry.ts` and
  not `openapi.ts` would be refused by this checker the day it turns on — the
  mechanism working, indistinguishable from a bug at 5pm. Merge after it too,
  and its field is the first test that the openapi-as-source rule bites.
- **composer** — photobook UI, no overlap.

So build it in two commits in one branch: `lib/validate/body.ts` plus its unit
tests first (touches nothing anybody else has open, mergeable immediately),
and the two route wirings second, rebased after B531 and B325 are on `main`.
