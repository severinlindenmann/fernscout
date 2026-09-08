---
id: B984
title: The conversation lives at three URLs and should live at one
type: FEATURE
priority: high
complexity: high
area: helper, routing, media
found: "2026-09-08T16:20:29Z"
started: "2026-09-08T16:54:03Z"
session: fdfcf5f2-0d32-4db4-bb1c-31e1dc373b09
claimed: "2026-09-08T16:54:03Z"
---

# B984 — The conversation lives at three URLs and should live at one

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

Asked for directly: *"make sure /agent/designer/chat does not exist, only
/agent, and all should happen on this single url."*

Today there are three pages under `/agent`:

| | |
| --- | --- |
| `/agent` | the door — signed out, a way in; signed in, a card per journal |
| `/agent/<user>` | the wizard (B682), and **the only page that uploads a photograph** |
| `/agent/<user>/chat` | the room, which is the product since B901 |

The journal's name is in the address bar of two of them, and the room — the
thing somebody actually uses — is two clicks and a path segment away from the
URL they were given.

## What was decided

- **The room is `/agent`.** The chat route goes.
- **The wizard is retired and the room absorbs uploading.** It is the biggest
  part of this and the reason the ticket is `high` complexity: the wizard is
  around two thousand lines, some of which has no home in a conversation. The
  room already has a files pane; what it needs is the picker and the camera
  input, and `add_photos` stops handing over a page.
- **Two things are remembered: the journal, and the conversation.** A switcher
  on the page for the journal. A parameter for the session, so copying the URL
  brings somebody back to that conversation — and so an older one can be
  reopened from a list.

## Work, in the order it has to happen

1. **B976 first**, and this ticket is blocked on it. Reopening a conversation
   needs conversations to be stored, which is what that builds. There is no
   point moving the room before there is a session to name in the URL.
2. `/agent` renders the room for the remembered journal, or the door when
   nobody is signed in. The switcher writes the choice somewhere that survives
   a visit.
3. The session parameter, and the list of past conversations that makes it
   worth having.
4. The picker and the camera into the files pane; `add_photos` opens the pane
   rather than a page; `components/OwnerTools.tsx` and the day's own controls
   follow.
5. Only then delete `app/agent/[user]/`. Not before: it is the only upload
   path, and `lib/search.ts` indexes it.

Not doing: a redirect from the old URLs to the new. They were never given out
to anybody but the owner, and a redirect is a second thing to keep working.

## Acceptance

`/agent` is the whole product for a signed-in owner. Nothing under `/agent/`
resolves. A photograph reaches a day without leaving the page. A copied URL
reopens the conversation it was copied from.
