---
id: B446
title: Subscribing fails in Brave and the reader is told only that it did not work
type: ISSUE
priority: medium
complexity: low
area: push, notifications
found: "2026-09-05T12:36:14Z"
merged: "2026-09-05T12:40:25Z"
---

# B446 — Subscribing fails in Brave and the reader is told only that it did not work

## Why

Pressing "Bei neuen Tagen benachrichtigen" in Brave leaves
`push.failed` — "Hat nicht geklappt. Bitte gleich nochmal versuchen." — and
trying again does the same thing for ever. Reported from fernscout.ch.

`components/pushSubscribe.ts` ends in a bare `catch { return "failed"; }`, and
the `!res.ok` branch above it says nothing either. So the one error that would
explain it is thrown away before anybody, reader or author, can read it: the
console is clean and the copy invites a retry that cannot work.

The likely cause is Brave itself. It ships with *Use Google services for push
messaging* off (`brave://settings/privacy`), and `pushManager.subscribe()`
then rejects with an `AbortError` rather than returning anything the page can
act on. That is a setting the reader can change and the only failure here that
one *can* — which is exactly the case the current message hides.

The point of the ticket is the swallowed error, not the guess. A user-visible
failure path that logs nothing cannot be diagnosed from a screenshot, and this
one has already cost a round trip.

## Work

- `components/pushSubscribe.ts`: log the real error, and the failing status on
  the server branch. One `console.warn` each; nothing is retried.
- Distinguish a rejection from `pushManager.subscribe()` as `unavailable` —
  the browser's push service refused — from a `failed` this end.
- `components/PushOptIn.tsx`: render `push.unavailable` for it, naming the
  Brave setting, in all three locales.

Not doing: `PushPrompt`, which dismisses itself on any result. That it hides a
failure is true and is its own capture if it matters.

## Acceptance

- In Brave with Google push services off: the card names the setting instead of
  offering a retry, and the console carries the `AbortError`.
- In Chrome or on Android, subscribing still works unchanged.
- `npm run verify`.
