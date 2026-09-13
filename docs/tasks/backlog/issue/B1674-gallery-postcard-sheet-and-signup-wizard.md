---
id: B1674
title: Gallery postcard sheet and signup wizard call v1 routes that no longer exist
type: ISSUE
priority: high
complexity: low
area: web
found: "2026-09-13T14:28:23Z"
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

Both callers hold a **cookie**, and `/api/v2` is bearer-only (decision 24), so
this is not a URL swap: each needs an `/api/web` cookie proxy of the kind
B1595 built for invites and channels, or the existing helper door. Decide
which per call rather than inventing a third pattern.

Not doing: any change to what a postcard is or how it is paid for.

## Acceptance

- `grep -rn "api/v1" components/` returns no `fetch(` call.
- The gallery's postcard sheet reaches a real recipients list on a journal
  that has one, in a browser, rather than showing "nobody has asked".
- The signup wizard creates a trip end to end in a browser.
- A test asserts the URL each component fetches, so this cannot recur
  silently.
