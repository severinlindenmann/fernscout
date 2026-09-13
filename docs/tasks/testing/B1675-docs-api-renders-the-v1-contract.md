---
id: B1675
title: /docs/api renders the v1 contract, not v2
type: ISSUE
priority: high
complexity: low
area: docs
found: "2026-09-13T14:28:31Z"
merged: "2026-09-13T14:39:23Z"
---

# B1675 — /docs/api renders the v1 contract, not v2

## Why

`app/docs/api/page.tsx:3,42` imports `openApiDocument` from
`@/lib/api/openapi` — the **v1** document — and renders it. `/docs/api` is one
of the `DOCS_PAGES` cards in `lib/docs.ts` and is the human-facing contract
page.

Live:

```
$ curl -s https://fernscout.ch/docs/api | grep -o '<h1[^<]*<[^>]*>[A-Za-z ]*'
<h1 ...>Fernscout API</h1>
```

v2's document titles itself `Fernscout — v2 API`. The page's top link points at
`/openapi.json`, and the operations listed are v1 doors — `/api/v1/journals`,
`/api/v1/{user}/keys`, `/api/v1/{user}/travellers` — most of which no longer
exist. `lib/api/openapi.ts` is meant to document only the three surviving v1
routes; the page renders the whole of it as though it were the contract.

Anyone reading `/docs/api` today is reading the retired API.

## Work

Point `app/docs/api/page.tsx` at `openApiDocumentV2()` from
`@/lib/api/v2/openapi`, and its download link at `/api/v2/openapi.json`.

Decide what happens to the three surviving v1 routes on that page — a short
section, or nothing at all and let `/openapi.json` carry them. Do not render
both documents as one list.

## Acceptance

- `curl -s https://fernscout.ch/docs/api` names v2 doors and the v2 document.
- A test asserts the page renders the v2 document, not v1.
