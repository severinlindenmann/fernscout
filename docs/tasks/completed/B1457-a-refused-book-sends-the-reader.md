---
id: B1457
title: A refused book sends the reader to a page to re-order instead of just saying try again
type: CHORE
priority: medium
complexity: low
area: photobook, i18n
found: "2026-09-11T12:35:06Z"
started: "2026-09-11T12:35:35Z"
merged: "2026-09-11T12:52:15Z"
---

# B1457 — A refused book sends the reader to a page to re-order instead of just saying try again

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

The owner's words, on seeing the refused card: *"the user has to buy over us,
just say try again or contact agent@fernscout.ch."*

Both strings sent the reader somewhere instead of telling them what to do:

> …und die Dateien unten gehören dir. **Bestell das Buch auf der Fotobuch-Seite
> der Reise erneut, wenn du es nochmal versuchen willst.**

> Du kannst es auch einfach nochmal bestellen, **auf der Fotobuch-Seite der
> Reise** — meist liegt es an der Druckerei und nicht an deinem Buch.

Naming a page a person has to navigate back to is a worse instruction than
"try again", and it is longer. The two routes that matter are: press it again,
or write to us.

## Work

Done — `photobook.print.refusedRefunded` (the page, B1454) and
`photobook.refused.next` (the failure mail) now read "Try again, or write to
agent@fernscout.ch", in English and German. `hu` carries the English text, as
the rest of the `photobook.*` block does.

No key added or removed; values only.

## Acceptance

- Neither string names a page to go to.
- Both offer the same two routes, and the address is `agent@fernscout.ch`.
- `npm run verify` clean.
