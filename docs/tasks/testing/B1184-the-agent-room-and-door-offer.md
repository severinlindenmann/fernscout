---
id: B1184
title: The agent room and door offer no way to change their language
type: ISSUE
priority: high
complexity: low
area: helper room, i18n
found: "2026-09-09T20:58:14Z"
started: "2026-09-09T20:58:34Z"
merged: "2026-09-09T21:06:35Z"
---

# B1184 — The agent room and door offer no way to change their language

## Why

The room replaced the page header, and the door never had one — so
`/agent` renders in whatever `requestLocale` derives from a cookie set
elsewhere or from `Accept-Language`, with no control anywhere on the page.
A German speaker on a phone somebody set up in English (the exact person
B838 names) talks to the helper through an English shell and has no way to
change it. Owner-directed, 2026-09-09.

## Work

`LocaleSwitcher` (the existing component, `subtle`) in the room's header
and on the door. Nothing new is built — the cookie it writes is the one
`requestLocale` already reads.

## Acceptance

At 390px and 1280px, signed in and signed out, /agent shows a language
chip; choosing Deutsch re-renders the page in German and survives a
reload.
