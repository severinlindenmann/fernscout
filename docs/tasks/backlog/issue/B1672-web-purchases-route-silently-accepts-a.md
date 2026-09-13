---
id: B1672
title: web purchases route silently accepts a bearer token despite its own cookie-only comment
type: ISSUE
priority: low
complexity: low
area: api-v2
found: "2026-09-13T13:57:08Z"
---

# B1672 — web purchases route silently accepts a bearer token despite its own cookie-only comment

## Why

AGENTS.md and `docs/v2-migration/00-decisions.md` decision 6/24 draw a firm
line: `/api/web` is the cookie-only prefix, `/api/v2` is the bearer-only
prefix, and the two credentials are never interchangeable — "the browser
never asks the question... an agent token reaches `/api/…` and never a
rendered page". Every other `/api/web/**` route that proxies into a v2
handler explicitly checks for and refuses an `Authorization` header before
proceeding.

`app/api/web/[user]/purchases/[id]/route.ts:69` is the one exception: it
calls `isOwner(user, request)`, and `isOwner`
(`lib/contacts/session.ts:35-72`) itself reads a bearer `Authorization`
header when present and accepts an owner-scoped (`write:content`) agent
token — it does not require a cookie at all. The route's own top-of-file
comment claims "Owner cookie only", which is no longer an accurate
description of what the route accepts, and it does not document the bearer
path as deliberate the way, say, D21's owner-tel routes document their own
narrower doors.

This is not a privilege escalation on its own — the token still has to be
owner-scoped, so nothing is granted that a bearer token could not otherwise
reach through `/api/v2` — but it breaks the stated pattern silently, and a
future change elsewhere that assumes "every `/api/web` route is cookie-only"
(a test, a rate-limit bucket, a security review) would be reasoning from a
false premise for this one file.

## Work

Either make `app/api/web/[user]/purchases/[id]/route.ts` refuse a bearer
`Authorization` header like every sibling `/api/web` route, or — if the
bearer path is actually wanted here for some reason (e.g. so an agent can
check purchase status without a browser session) — say so explicitly in the
route's own comment and confirm it is the deliberate, sole exception, the
same way other one-off departures are called out elsewhere in this codebase.

## Acceptance

`app/api/web/[user]/purchases/[id]/route.ts`'s comment and behaviour agree,
and either match every other `/api/web` route (cookie-only, bearer refused)
or are explicitly justified as the one exception.
