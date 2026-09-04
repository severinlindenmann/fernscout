---
id: B299
title: No visual page to browse the API endpoints
type: FEATURE
priority: medium
complexity: low
area: docs, api
found: "2026-09-04T13:59:26Z"
started: "2026-09-04T13:59:42Z"
merged: "2026-09-04T14:14:10Z"
completed: "2026-09-04T21:54:18Z"
---

# B299 — No visual page to browse the API endpoints

## Why

`/openapi.json` (`app/openapi.json/route.ts`) already carries the whole API as
a hand-written OpenAPI 3.1 document — every path, schema and description an
agent needs. A person who wants to see the same thing has no way to read it:
it's one unformatted JSON blob, no page renders it.

## Work

A server-rendered page at `/api/docs` that reads the same OpenAPI document
(`app/openapi.json/route.ts`'s document, factored out into a shared function so
both routes build it once) and lists every path — method badge, summary,
description, parameters, request body, responses — grouped and styled with the
existing Tailwind brand tokens (`app/globals.css`). No client JS, no new
dependency: native `<details>/<summary>` for any collapsing, per
`apply-the-brand` for colour/contrast. Not doing: a "try it" request sender —
this is a reading surface, not an alternative to Postman.

## Acceptance

`GET /api/docs` returns HTML listing every path currently in `/openapi.json`,
with each one's methods, summary and responses visible without JavaScript.

Also links the new page from the landing page (`components/Landing.tsx`),
next to the "Fernscout is open source" link, since that was asked for in the
same turn.
