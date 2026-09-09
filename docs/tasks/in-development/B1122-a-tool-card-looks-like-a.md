---
id: B1122
title: A tool card looks like a form rather than a decision, and its controls are unreachable under a phone keyboard
type: FEATURE
priority: high
complexity: medium
area: components/HelperAsk.tsx
found: "2026-09-09T17:45:58Z"
started: "2026-09-09T17:49:37Z"
session: fdfcf5f2-0d32-4db4-bb1c-31e1dc373b09
claimed: "2026-09-09T17:49:37Z"
---

# B1122 — A tool card looks like a form rather than a decision, and its controls are unreachable under a phone keyboard

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

Two faults, one file.

**A card looks like a form.** Granting somebody write access to a whole trip is
drawn exactly like changing a title: a sentence, three boxes, a button. Nothing
names the kind of decision before you read it, and nothing distinguishes a card
that grants, spends or destroys from one that renames.

Every trip card also leads with an editable box holding `iceland-2026` — a
folder name the person has never seen, which is **B1107**, and which the
prompt's own rule forbids ("Never ask them for an id … none of those are on
their screen").

**On a phone the button is unreachable.** Tap a field, and the keyboard covers
the press. The card scrolls, and the person cannot tell whether anything
happened. This is the single worst mobile fault in the room.

## Work

**Cards.** A resolved field renders as a chip inside the sentence rather than
an editable box — one renderer change that fixes B1107 for every card that
exists and every one added later. An icon and a title name the kind of
decision. Cards that grant, spend or destroy take a coral rule; ordinary edits
stay cream, so the colour is the warning rather than the wording.

**Under a keyboard.** The primary button detaches and pins directly above the
keyboard while any field on that card has focus, with the quiet "Leave it"
beside it — a confirmation where only the yes is in reach is not a
confirmation. Use the visual viewport rather than a fixed keyboard height.
Field kinds are already declared, so `inputmode`, `type="date"` and
`enterkeyhint` are a rendering detail.

**Chips.** On a phone they should be *bigger* than on a desktop: full-width
rows of at least 44px, title left and date right, a long list cut to four with
a "show more". An untitled day says "Ohne Titel" rather than printing its date
twice, which is what it does today.

Not doing: `window.confirm` in any form — B633 and `test/no-browser-dialogs`.

## Acceptance

At 390px, focus a field on a card and the press stays visible above the
keyboard. No card shows a raw trip id. A day with no title reads "Ohne Titel"
once.
