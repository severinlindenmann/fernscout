---
id: B1708
title: An owner's own journal disappears from Your journals while it has no trips
type: ISSUE
priority: high
complexity: low
area: home, journal list
found: "2026-09-14T08:29:34Z"
started: "2026-09-14T08:29:54Z"
session: 87520719-7ed7-4d9f-84f4-27f111ccad78
claimed: "2026-09-14T08:29:54Z"
---

# B1708 — An owner's own journal disappears from Your journals while it has no trips

## Why

Reported on fernscout.ch: signed in as the owner of `/severin`, the landing
page says "Your journals · Signed in as … · Nothing yet. When somebody invites
you into their journal, or you start your own, it will appear here." The
journal exists and the address owns it. It has no trips yet.

`journalsFor()` in `lib/home.ts` drops a journal with no visible trips unless
the caller passes `evenIfEmpty`. B1019 added that flag for `/agent` only
(`app/agent/page.tsx:94`); `GET /api/v2/me/home`
(`app/api/v2/me/home/route.ts:34`) still asks without it, so the page that
says *Your journals* answers a different question — *what can I read* — and
tells a brand new owner they have nothing, one sentence after naming them.

The flag's premise is that the home list is a reading list. The heading says
otherwise, and both callers want the same answer, so the flag has no second
caller to justify it.

## Work

Delete the `evenIfEmpty` option. Keep a journal the address **owns** even when
it has no visible trips; keep dropping everybody else's empty journal, which
is the part of the guard that matters (a guest of an empty journal has nothing
there).

`test/home.test.ts` has a keeper asserting the old default ("is not on the
reading list"). This ticket changes that contract deliberately: rewrite it to
assert the owner keeps their own empty journal and a stranger still never sees
it.

## Acceptance

- An owner signed in with one journal and no trips sees that journal's card on
  `/`, not the "Nothing yet" sentence.
- A stranger, and a guest with no visible trips, still see nothing of it.
- `npm run verify` green; checked in a browser at desktop and phone width.
