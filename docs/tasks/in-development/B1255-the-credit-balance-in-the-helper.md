---
id: B1255
title: The credit balance in the helper header does not change when a credit is spent
type: ISSUE
priority: medium
complexity: low
area: helper, credits
found: "2026-09-10T09:57:28Z"
started: "2026-09-11T06:40:37Z"
session: 13f12910-ff28-4566-894a-9e2b3d055281
claimed: "2026-09-11T06:40:37Z"
---

# B1255 — The credit balance in the helper header does not change when a credit is spent
## Why

Writing a day up costs a credit, and the card says so: *"…you read it before any
of it is kept, and it costs 1 credit."* Pressing **Save these words** spends it.

The pill in the helper's header still read **10** afterwards. Reloading the page
showed **9**. So the spend happened, and the one number on screen that reports it
did not move.

That number is not decoration. It is the button that opens the account sheet, it
is what the room's own low-credit warning is derived from (`lowCredits` in
`components/HelperRoom.tsx:450`), and it is the only running total a person has
while they work. A phone session lasts as long as the person keeps typing and is
never reloaded, so the balance they watch can be several days' worth out of date
by the time they stop — and the moment it does update is a reload, where it
appears to drop by several at once.

Found on fernscout.ch at 390x844, 2026-09-10: 10 before, 10 shown after the
spend, 9 after a reload.

## Work

- The response to a spend already knows the new balance, or can. Feed it back
  into the same state the pill renders from, rather than only on load.
- Check every path that spends, not only the write-up: photographs, transcription,
  a message sent, whatever else `recordUsage` sits behind.

## Acceptance

- Spend a credit in the helper without reloading; the pill decreases within the
  same turn.
- Crossing the low threshold during a session shows the warning without a reload.
