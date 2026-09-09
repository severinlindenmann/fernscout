---
id: B1032
title: A day's title colliding with another day's slug is still an English sentence on the helper
type: ISSUE
priority: low
complexity: low
area: agent, i18n
found: "2026-09-08T20:51:15Z"
started: "2026-09-09T06:09:08Z"
session: f88144a1-6520-4fc1-94bd-496a694b98c8
claimed: "2026-09-09T06:09:08Z"
---

# B1032 — A day's title colliding with another day's slug is still an English sentence on the helper

## Why

B785 fixed one raw English refusal reaching a German helper screen — pressing
"Diesen Tag beginnen" twice for the same day, where `createDraft` in
`lib/api/entries.ts:519` returns `` `an entry already exists at ${date}-${slug}` ``.
Right below it (`lib/api/entries.ts:544`) `createDraft` has a second, sibling
collision: a title that slugs the same as an existing day's, on a *different*
date. That branch still returns free English prose
(`` `an entry already exists with the slug "${slug}" in this trip — ${taken}. …` ``)
straight through `app/api/helper/[user]/day/route.ts`'s `POST`, same as the
first one was before B785.

B785 left this one alone deliberately: in the wizard's `start_day` proposal,
`title` is always set to the date string, so two different dates essentially
never produce the same slug there, and the ticket's own acceptance line is
about a refusal "a person can reach by ordinary use." It is a real gap, just
one nobody has demonstrated hitting from the wizard yet — worth its own
ticket rather than silently expanding B785's scope.

There is also a broader shape worth checking while somebody is in this
file: `editEntry`, `publishDraft` and `unpublishDraft` (also in
`lib/api/entries.ts`) return similar free-text refusals that
`app/api/helper/[user]/day/route.ts` (PATCH), `.../publish` and
`.../unpublish` forward raw via `edited.error` / `published.error` /
`taken.error`. B785's audit found every one of those gated by a stable-code
check earlier in the route (`already_published`, `incomplete_day`, …) or
marked `bug: true` / a concurrent-write case — not ordinary use — but that
was a manual read, not a test, so it is worth a second look if the helper
grows a path that can reach one.

## Work

Give the "slug taken by a different date" branch of `createDraft` a stable
`code` (the same `code?: string` field on `WriteResult` B785 added), a
locale-backed sentence in `agent.error.*` explaining a person needs a title
that reads differently, and confirm whether it is actually reachable from the
wizard (a title a person typed by hand in a future free-text day-creation
flow, rather than the fixed `title: date` the current `start_day` proposal
sends). If it turns out unreachable from any wizard path, downgrade this to a
note rather than a fix.

## Acceptance

Either: no English sentence from this branch can reach a German helper
screen by any wizard flow (with a test proving the path and the translation,
as B785 did for the sibling collision) — or a documented finding that no
current wizard flow can produce a title colliding this way, closing the
ticket without a code change.
