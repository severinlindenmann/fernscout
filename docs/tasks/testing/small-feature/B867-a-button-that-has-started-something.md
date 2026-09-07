---
id: B867
title: A button that has started something slow looks exactly like one that has not
type: FEATURE
priority: medium
complexity: medium
area: ui
found: "2026-09-07T17:35:20Z"
started: "2026-09-07T17:35:44Z"
merged: "2026-09-07T18:05:07Z"
---

# B867 — A button that has started something slow looks exactly like one that has not

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

Reported after a real send: pressing a button that starts network work leaves
the button looking untouched. Nothing is disabled, nothing moves, and the only
honest reading available to the person is that the press did not register — so
they press again.

Thirty-four components fire async work from a button. The state of them today:

- Most track a `busy` flag and express it as `disabled:opacity-50` and a
  swapped label. That is a fade and a word; on a phone, mid-scroll, it is not
  enough to say "this is working".
- Eleven track nothing at all — `AddressLookupField`, `HelperAskHere`,
  `IdentityUpgrade`, `Landing`, `PushInstallOnboarding`, `DeleteConfirm`,
  `PushOptIn`, `SearchBox`, `SignInButton`, `TripStory` among them. Those
  buttons stay fully live and fully pressable while their request is in
  flight.
- **There is no spinner anywhere in this codebase.** `animate-pulse` appears
  three times, all of them skeleton placeholders. Nothing that says "your press
  did something".

Two of these cost money or make duplicates when double-pressed: the postcard
send (`POSTCARD_CREDITS` a card) and the credit purchase. `claimForSend` makes
a double send safe on the server, which is the right place for it — but a
person pressing twice because the button lied to them is a bug regardless of
whether the second press is absorbed.

The postcard send button is a deliberate case and needs care rather than
avoidance. Its comment says a spinner "would need JavaScript, and this button's
whole design is that it does not". That is a `<form method="post">` in a server
component, and it must keep working with no JavaScript at all — so whatever is
built has to be an enhancement over a working native submit, never a
replacement for one. Same for the two other native posts:
`PostcardBack.tsx:225` and `BookLevelView.tsx:345`.

## Work

One shared component, then apply it everywhere.

1. `components/BusyButton.tsx` — disables, sets `aria-busy`, shows a spinner
   before the label, and swaps the label for a busy one where a string exists.
   `prefers-reduced-motion` gets a fade rather than a spin.
2. It takes `busy` for the fetch-driven callers, which already hold that state.
   With `busy` omitted it manages its own, from its form's `submit` event —
   which is what lets the three native `method="post"` forms keep working with
   JavaScript off and gain the spinner when it is on.
3. Apply to all 34.

**Not doing:** a global request-in-flight indicator, an optimistic-UI layer, or
disabling forms as a substitute for the server-side guards. `claimForSend` and
`lib/idempotency.ts` stay exactly as they are — this is about what the person
sees, not about what the server trusts.

## Acceptance

- Every button that starts async work is disabled and visibly spinning while it
  runs.
- The three native `method="post"` forms still submit with JavaScript disabled.
- Looked at on a phone width, not only asserted in a test.
