---
id: B921
title: The conversation speaks the phone's language, not the journal's
type: ISSUE
priority: high
complexity: low
area: agent, i18n
found: "2026-09-08T07:08:53Z"
started: "2026-09-08T11:17:02Z"
merged: "2026-09-08T11:21:49Z"
completed: "2026-09-09T16:46:51Z"
---

# B921 — The conversation speaks the phone's language, not the journal's

## Why

The chat room renders in **the browser's** language, not the journal's.

A 71-year-old tester: her daughter set up her iPhone, so its menus are English;
her journal is German. On her own phone she would meet the room in English —
title "Talk it through", placeholder "Make a new trip to Japan in March", "Or
ask me something" — on a journal she writes in German.

Every German sentence quoted in her report only appeared because the test sent
`Accept-Language: de`. On her actual phone she would have seen none of them.

Her words: *"It should follow the journal's own language, not my phone's menu
setting."*

This is the same rule B857 established for mail — the journal's `defaultLocale`
first, the request's language second — applied to the one surface that is now
the whole product.

## Work

The room and the conversation take the journal's `defaultLocale`, falling back
to `accept-language`, exactly as the mail does. `defaultLocaleFor(user)` already
exists and the transcribe route already uses it.

Check every other owner-facing page for the same fault while there.

## Acceptance

A German journal's owner meets a German room on an English phone.
