---
id: B1547
title: documentation.txt reads machine-generated and has drifted from the API
type: DOCS
priority: medium
complexity: low
area: documentation.txt, lib/api/documentation.ts
found: "2026-09-11T22:30:20Z"
---

# B1547 — documentation.txt reads machine-generated and has drifted from the API

## Why

`GET /documentation.txt` (`app/documentation.txt/route.ts`) serves
`instanceDocumentation()` from `lib/api/documentation.ts` — this is the whole
brief an agent with no checkout gets before it writes anything to somebody's
journal (AGENTS.md, "The network doors"). The owner has read it and flagged
two problems: it reads as machine-generated in places (verbose, repetitive,
oddly phrased), and it has drifted from what the API actually does in places
— exactly the failure mode `keep-the-contract` exists to catch for
`/openapi.json`, but this file is prose rather than a schema and nothing
mechanical checks it.

This is explicitly **not** a rewrite for an agent to do unsupervised — the
words are what a stranger's agent trusts to write into somebody's travel
journal, and a plausible-sounding but wrong rewrite is worse than a clunky but
correct one. This ticket is the human editorial pass itself, not automation of
it.

## Work

A person reads the live output of `instanceDocumentation()` end to end
against the current API surface (routes in `app/api/v1/`, the `/skill/*.md`
guides it links, `lib/api/openapi.ts`) and:

- marks sentences that no longer match what a route actually does or accepts,
- rewrites clumsy/repetitive phrasing in their own words,
- edits the source strings in `lib/api/documentation.ts` directly (this is a
  targeted edit, not a from-scratch rewrite — most of the structure and a lot
  of the wording stays).

Not doing: no change to the route's caching or headers, no restructuring of
what's covered vs. what `/skill/*.md` covers separately.

## Acceptance

A person has read the full rendered output of `GET /documentation.txt`
against the current API and confirms it is accurate and no longer reads as
machine-generated. This ticket cannot be closed by an agent running tests —
`npm run tasks -- move B1547 testing` only after that human read has actually
happened, and `completed` after the same person is satisfied with the result.
