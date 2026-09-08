---
id: B724
title: A capability that needs another one is an if rather than a field
type: CHORE
priority: low
complexity: low
area: capabilities
found: "2026-09-07T11:44:12Z"
started: "2026-09-08T05:41:11Z"
session: 41335894-5435-4167-8cb6-898e370cd6a9
claimed: "2026-09-08T05:41:11Z"
---

# B724 — A capability that needs another one is an if rather than a field

## Why

`lib/capabilities.ts:238` — `helper` is the first capability that requires
another (`credits`), and it is expressed as an `if` in the resolver rather than
as a field on `Requirement` beside `env` and `db`. One is fine; a second would
make the resolver a place where dependencies hide.

## Acceptance

Capability dependencies are data, and `/api/health` reports a missing one the
same way it reports a missing environment variable.
