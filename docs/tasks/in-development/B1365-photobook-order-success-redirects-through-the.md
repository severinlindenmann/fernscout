---
id: B1365
title: Photobook order success redirects through the trip page instead of straight to the order page
type: CHORE
priority: low
complexity: low
area: photobook
found: "2026-09-10T18:27:27Z"
started: "2026-09-11T04:23:04Z"
session: 96a5b964-fad1-4616-9124-a01eabbd8a46
claimed: "2026-09-11T04:23:04Z"
---

# B1365 — Photobook order success redirects through the trip page instead of straight to the order page

## Why

Pressing Buy in `app/[user]/photobook/order/route.ts` finishes with
`return back_("done", { order: orderId })` (line 377), which redirects to
`/<user>/trips/<trip>/photobook?state=done&order=<id>`. That page
(`app/[user]/(trip)/photobook/PhotobookPageContent.tsx:591-644`) then renders
a "done" panel with download links and a link to the real order page,
`/<user>/photobooks/<id>` (`app/[user]/photobooks/[id]/page.tsx`) — which
already shows the same download links, a receipt heading, and print/status
info on its own. The trip-page panel is a redundant stop between the buy
press and the page that actually matters; the owner explicitly asked for the
buy press to land there directly.

## Work

In `app/[user]/photobook/order/route.ts`, replace the final
`return back_("done", { order: orderId });` with a direct redirect to
`/${encodeURIComponent(user)}/photobooks/${orderId}` (same relative-URL /
303 reasoning as the existing `back()` helper — see its doc comment). Leave
`back()`/`back_` and every other outcome (`no_photos`, `stale_preview`,
`no_credits`, `failed`, `print_refused`, etc.) redirecting to the trip page
exactly as before — only the success path changes.

The now-unreachable `state=done` branch in `PhotobookPageContent.tsx`
(the panel at lines 591-644, and `outcome.state === "done"` handling) should
be removed, since nothing will redirect there with `state=done` again — check
first whether `OUTCOME_MESSAGE` / outcome-state plumbing elsewhere still
needs `"done"` as a valid `PhotobookOutcomeState` for anything (e.g. does
`print_refused` also need `order` params that reuse shared code with the done
case?) before deleting types.

Not touching: the order page itself, or any other outcome state's redirect.

## Acceptance

Ordering a photobook (owner, real journal or a `test:` one) redirects the
browser straight to `/<user>/photobooks/<id>` after a successful buy, with no
intermediate trip-page "done" panel. Every other outcome (no_photos,
no_credits, stale_preview, duplicate, no_room, no_recipient,
printer_unavailable, failed, print_refused) still redirects to the trip page
with its existing message. `npm run verify` passes.
