---
id: B1094
title: Editing a contact opens a form off-screen above the button, so the button looks broken
type: ISSUE
priority: medium
complexity: low
area: components/ContactsAdmin.tsx
found: "2026-09-09T16:20:00Z"
started: "2026-09-11T13:21:53Z"
session: 13f12910-ff28-4566-894a-9e2b3d055281
claimed: "2026-09-11T13:21:53Z"
---

# B1094 — Editing a contact opens a form off-screen above the button, so the button looks broken

## Why

Reported as *"why can't I press Bearbeiten here?"*, from a contact card in the
**Freigegeben** group on `/<user>/contacts`.

The button is not disabled and the press is not swallowed. `onEdit` sets
`formTarget` (`components/ContactsAdmin.tsx:554` → `1600`), and `GuestForm`
renders in the block at line 1559 — which is **above every contact group**,
beside the "Gast hinzufügen" button. So the form opens where the reader is not
looking, nothing scrolls them to it, and focus stays where it was.

Measured on the live instance, signed in as the owner, on this exact card:

| | button top | form top | form opens above by |
| --- | --- | --- | --- |
| 390px | y 1148 | y 754 | **394px** |
| 810px | y 1090 | y 736 | **354px** |

`document.querySelectorAll('input')` goes from 15 to 28 on the press, so the
form is certainly there. `document.activeElement` is unchanged. From the
reader's side, pressing a button changes nothing they can see — which is
indistinguishable from a dead control, and is what was reported.

It gets worse the further down the list the contact is: a journal with a dozen
readers can put the whole list between the button and its own result.

This is the same fault B877 fixed one level up — a control and its effect in
different places — and the reason this project keeps confirmations as panels
*in the flow* rather than dialogs elsewhere.

## Work

Take the form to the reader rather than the reader to the form. In rough order
of preference:

- **Render `GuestForm` in place**, inside the card being edited, the way
  `EditDay` sits under the day it corrects (B980). The card is already the
  right frame and this removes the distance rather than compensating for it.
- Failing that, move focus into the form's first field on open, which at least
  scrolls the viewport there and tells a screen-reader user what happened.

Whichever is chosen, the "new guest" case keeps its current position — it
belongs at the top, where the button that opens it is.

Not doing: a scroll-into-view call alone. It moves the page under somebody's
thumb without saying why, and the reader loses the row they were working on.

## Acceptance

- Pressing **Bearbeiten** on the last contact in the longest group, at 390px,
  puts the edit form on screen without the reader hunting for it.
- Focus lands somewhere inside the form.
- The "new guest" form still opens where it does today.
