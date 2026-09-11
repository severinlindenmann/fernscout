---
id: B1515
title: The back has a save button for something that saves itself, and a warning the price already gives
type: ISSUE
priority: medium
complexity: low
area: postcards
found: "2026-09-11T19:47:14Z"
started: "2026-09-11T19:47:40Z"
merged: "2026-09-11T20:06:19Z"
---

# B1515 — The back has a save button for something that saves itself, and a warning the price already gives

## Why

Two controls that answer questions nobody has:

- **`Rückseite speichern`.** The back saves itself on a 700ms debounce and
  says `Gespeichert` directly under the button. A save button beside a
  saved-state indicator asks somebody to do the thing that has already
  happened, and leaves them wondering what it did that the indicator did not.
- **The warning above the send press** (B1489): *"Damit werden echte Karten
  gedruckt und verschickt, und die Credits sind weg. Das lässt sich nicht
  rückgängig machen."* The price card directly above it names the credits and
  the francs, the button names them again, and the confirm step that the press
  leads to says the undoable part in its own words. Three times before
  anything happens.

## Work

The button goes; the debounce and the `Gespeichert` indicator stay exactly as
they are — nothing about saving changes, only the furniture around it.

The warning goes from the first press. **The confirm step keeps its own**
`undone` line: that is the screen where the money actually moves, and one
sentence there is the one that is worth having. Check it is still rendered
before deleting anything.

## Acceptance

No save button on the Write step and the back still saves as you type; the
Send step shows the price and the button with no warning above them, and the
confirm step still says it cannot be undone.