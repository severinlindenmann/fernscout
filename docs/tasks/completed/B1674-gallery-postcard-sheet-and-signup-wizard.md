---
id: B1674
title: Gallery postcard sheet and signup wizard call v1 routes that no longer exist
type: ISSUE
priority: high
complexity: medium
area: web
found: "2026-09-13T14:28:23Z"
merged: "2026-09-13T18:32:49Z"
completed: "2026-09-14T16:32:39Z"
---

# B1674 — Gallery postcard sheet and signup wizard call v1 routes that no longer exist

## Why

Two live browser components still `fetch()` v1 routes the migration deleted.
The routes answer 404 on the deployed instance — verified:

```
/api/v1/test-validator/postcards/recipients      404
/api/v1/test-validator/trips                     404
```

- `components/PostcardSheet.tsx:130,131,162` — `…/postcards/recipients`,
  `…/postcards/texts`, and the `POST …/postcards` that proposes the card.
  Reached from `components/GalleryGrid.tsx`, a published page. The failure is
  silent rather than loud: `recRes.ok` is false, the code falls back to
  `{recipients: []}` and renders "nobody has asked for a card". An owner is
  told nobody wants a postcard when the truth is the door was moved.
- `components/SignupWizard.tsx:438` — `POST /api/v1/<user>/trips`, the
  wizard's create-trip step, reached from `app/[user]/me/MePageContent.tsx`
  and `components/AgentDoor.tsx`.

`npm run verify` is green with both of these in place: nothing asserts the URL
a component fetches, which is why the migration's own route sweep missed them.

## Work

Repoint both at the v2 doors that already exist:

- `GET /api/v2/{user}/postcards/recipients`, `GET /api/v2/{user}/postcards/texts`
- `PUT /api/v2/{user}/postcards/orders/{id}` for the proposal
- `PUT /api/v2/{user}/trips/{id}` for the wizard's trip

**Neither half is a URL swap, and they fail differently:**

- `SignupWizard` already holds an **agent token** (`post(..., agentToken)` at
  line 437), so it may call `/api/v2` directly. What stops it is the shape:
  it sends `{id, title, start, end}` and v2's create asks eleven declinable
  sections plus `dates`, `visibility` and `people`. Somebody has to decide
  what a wizard may honestly decline on the owner's behalf — a decline reason
  is a sentence a person will read, and the wizard must not invent one. That
  is the owner's call, not a refactor.
- `PostcardSheet` sends no credential at all, so it is a **cookie** caller,
  and `/api/v2` is bearer-only (decision 24). There is no `/api/web`
  postcards proxy today (`find app/api/web -path '*postcard*'` → nothing), so
  this half needs the proxies B1595 built for invites and channels.

Not doing: any change to what a postcard is or how it is paid for.

## Acceptance

- `grep -rn "api/v1" components/` returns no `fetch(` call.
- The gallery's postcard sheet reaches a real recipients list on a journal
  that has one, in a browser, rather than showing "nobody has asked".
- The signup wizard creates a trip end to end in a browser.
- A test asserts the URL each component fetches, so this cannot recur
  silently.
