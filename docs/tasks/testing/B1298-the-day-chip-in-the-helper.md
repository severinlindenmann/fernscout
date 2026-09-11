---
id: B1298
title: The day chip in the helper downloads three 2000px photographs to draw three 38px thumbnails
type: ISSUE
priority: low
complexity: low
area: helper, performance
found: "2026-09-10T11:13:04Z"
started: "2026-09-11T06:40:32Z"
merged: "2026-09-11T08:13:16Z"
---

# B1298 — The day chip in the helper downloads three 2000px photographs to draw three 38px thumbnails
## Why

The chip in the helper room that shows which day is being talked about renders
three thumbnails **38px tall**, and requests each of them at `?w=2000`:

```
/test-mobile/media/bern-weekend-2026/2026-09-05/01.jpg?w=2000   45,686 bytes
/test-mobile/media/bern-weekend-2026/2026-09-05/01.jpg?w=96      8,438 bytes
```

So about **137 KB** is downloaded to draw 114px of thumbnails, where roughly 25 KB
would do. The derivative pipeline is already there and already correct elsewhere —
the day page asks for `?w=320` for its 150px polaroids.

It is not a crisis, and it is the wrong number in the one room whose whole
premise is somebody on the road describing their day from a phone, on whatever
signal they have.

## Work

- Ask for a width that matches the slot, at 2× for retina — `?w=96` covers a 38px
  thumbnail on any phone.
- Check the room's other image chips for the same request; this one was found by
  reading the DOM, not by noticing slowness.

## Acceptance

- The day chip's thumbnails are requested at a width proportionate to how they
  render.
- The day page's polaroids are unchanged.
