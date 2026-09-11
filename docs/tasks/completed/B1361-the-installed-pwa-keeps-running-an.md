---
id: B1361
title: The installed PWA keeps running an old build with nothing saying so
type: FEATURE
priority: high
complexity: low
area: helper
found: "2026-09-10T18:23:03Z"
started: "2026-09-10T18:23:13Z"
merged: "2026-09-10T18:29:52Z"
---

# B1361 — The installed PWA keeps running an old build with nothing saying so

## Why

The offline service worker updates only on the next launch, so the
installed PWA keeps running an old build with nothing saying so — the
owner's phone showed bugs the web had already lost (F03 A).

## Work

The room remembers the server's build id (`/api/health` commit) from its
first read and re-asks whenever the app returns to the foreground; a
different answer draws one strip under the header — "Neue Version — neu
laden" — whose press reloads. Unsent words survive: the draft is stored on
every keystroke (B1211/D16).

## Acceptance

With the room open, a changed server commit plus a visibilitychange shows
the reload strip (verified in Playwright with a stubbed health answer);
pressing it reloads. On the phone: background the PWA during a deploy,
return, see the chip.
