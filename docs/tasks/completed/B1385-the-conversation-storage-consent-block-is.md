---
id: B1385
title: The conversation-storage consent block is shown to signed-out visitors
type: ISSUE
priority: high
complexity: low
area: helper, consent, privacy
found: "2026-09-10T19:15:55Z"
started: "2026-09-11T06:40:38Z"
merged: "2026-09-11T07:39:01Z"
---

# B1385 — The conversation-storage consent block is shown to signed-out visitors

## Why

`/<user>/me` renders for every reader, including one with no session at all —
`app/[user]/me/page.tsx:51` says so in as many words. The conversation-consent
block renders there too, and its only gate is whether the journal has the
helper capability switched on:

```
app/[user]/me/page.tsx:207
  sessionsShared={isEnabled("helper", user) ? operatorMayRead(user) : null}
app/[user]/me/MePageContent.tsx:1138
  {sessionsShared !== null && <SessionsConsent … />}
```

Nothing asks who is reading. So a signed-out stranger who opens somebody's
journal is shown:

> **Deine Gespräche** — Gespräche mit dem Helfer werden gespeichert, damit du
> eines später wieder öffnen und weitermachen kannst.
> **Wir lesen mit, um Fernscout zu verbessern** — Ausschalten löscht nichts —
> deine Gespräche bleiben für dich da.

Every "du" in that is addressed to somebody who has no conversations, has never
spoken to the helper, and has nothing to consent to. It reads as a claim about
the reader's own data when it is a setting on somebody else's journal, which is
the worst way for a privacy control to be wrong: it is either meaningless or
alarming, and a reader cannot tell which.

There is a second half worth checking while in here. `operatorMayRead(user)` is
a per-journal fact and `SessionsConsent` posts a change back — so whether the
*write* path refuses a stranger needs confirming, not assuming. If it does not,
this is a SECURITY finding and should be split out as one.

## Work

Gate the block on the reader, not on the capability. Per the author: **owner and
buddies only** — anybody who could actually have a conversation with the helper
on this journal. Everyone else, signed out or merely a guest, sees nothing.

The reader level is already on this page and already spells out exactly the
three populations this needs — `MePageContent.tsx:1091` picks a guide with
`viewer.owner ? "creator" : writableTrips.length > 0 ? "buddy" : "guest"`. Use
`viewer` and `writableTrips`; do not read a cookie directly and do not add a
second source of truth beside `sessionsShared`.

B1386 is on the same page and the same line, so the two may want building
together.

Check the API route behind the toggle refuses a caller who is not the owner. If
it does not, capture that separately as SECURITY and reference it by id here —
do not fold the fix into this ticket.

Not in scope: the wording itself, and `HelperConsentList` just above it, unless
it turns out to have the same missing gate (check it; it plausibly does).

## Acceptance

- Signed out, open `/<user>/me` on a journal with the helper enabled: no
  "Deine Gespräche" block, no "Wir lesen mit" line.
- Signed in as a guest of that journal: still absent.
- Signed in as the owner: present and working as before.
- Signed in as somebody on a trip's `people:` (a buddy): present.
- `npm run verify` passes.
