---
id: B1671
title: Trip write path auto-fills declined.days without the caller ever declining it
type: ISSUE
priority: low
complexity: low
area: api-v2
found: "2026-09-13T13:56:49Z"
merged: "2026-09-13T19:50:31Z"
---

# B1671 — Trip write path auto-fills declined.days without the caller ever declining it

## Why

`docs/v2-migration/00-decisions.md` states plainly: "Everything
asked-or-declined: `declined: {field: "reason"}`... A `declined` entry is
only ever written when a person actually declines" (this exact sentence is
also quoted in this review's brief as one of the five headline claims being
checked).

`app/api/v2/[user]/trips/[trip]/route.ts` (PUT at lines ~163-169, PATCH at
~378-383) does not follow this: whenever `merged.days === undefined` and the
trip has no stored `declined.days` yet, it auto-injects
`declined.days = "days are written and changed through their own route, not
re-asked on a trip replace/once a trip exists"` — with no caller-supplied
`declined.days` at all. The reasoning is sound (a trip's `days` really is
answered elsewhere, by `PUT .../days/{slug}`, and re-asking it on every trip
replace would be nonsensical) but it is a real, undocumented exception to
the decision as stated, and it means a trip's stored `declined` map can
contain an entry the owner never wrote and never saw — which is exactly the
category of thing decision 3 says never happens.

## Work

This is not necessarily wrong to keep — `days` genuinely has no other honest
spelling for "already answered, elsewhere" — but it needs to be an
accounted-for exception rather than silent drift. Either:
(a) add a contract-deltas-style row documenting it as a deliberate,
authorised departure from decision 3's literal wording, with the same
reasoning as above, or
(b) change the mechanism so it does not literally write into `declined` —
e.g. treat `days` as an `ANSWERED_ELSEWHERE`-style structural exemption from
`checkRequiredOrDeclined` entirely, the same way `buddies` is handled
(`lib/api/v2/incomplete.ts:44-50`), rather than synthesizing a decline
string nobody wrote.

## Acceptance

Either a decisions/deltas document names this exception explicitly, or the
code no longer writes an auto-generated `declined.days` value — pick one and
make the two agree.
