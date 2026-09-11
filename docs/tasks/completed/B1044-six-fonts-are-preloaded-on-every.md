---
id: B1044
title: Six fonts are preloaded on every page and none of them is used in time
type: ISSUE
priority: low
complexity: low
area: performance, fonts
found: "2026-09-09T05:35:00Z"
started: "2026-09-11T08:42:24Z"
merged: "2026-09-11T10:01:16Z"
---

# B1044 — Six fonts are preloaded on every page and none of them is used in time

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

Found on 2026-09-09 while checking a live day page in a real browser for
hydration errors after B42. There were none — but the console carried six of
these, on `https://fernscout.ch/example/day/oregon-coast`:

```
The resource https://fernscout.ch/_next/static/media/1a099d89ee94ee96-s.p...woff2
was preloaded using link preload but not used within a few seconds from the
window's load event.
```

Six `woff2` files, every one of them preloaded and none of them drawn on in
time. It costs a reader on a hotel connection six requests that buy nothing,
before the ones that do. It is not a correctness fault and nothing looks
wrong, which is why it has sat there unnoticed.

The likely cause is `next/font` preloading every declared weight and style of
every family rather than the subset a page actually sets, but that is a guess
and the first job is to find out rather than to act on it.

## Work

- Find where the faces are declared (`app/layout.tsx` and whatever
  `next/font` calls it makes) and establish which of the six a typical page
  genuinely paints with — a day page, the landing page and `/agent` are three
  different answers and the fix has to hold for all three.
- Then the smallest thing that stops preloading what is not used. `preload:
  false` on the faces that are decorative or rare is usually it; a narrower
  `subsets`/weight list may be enough on its own.
- Check the result the same way it was found: load a live page over CDP and
  read the console, rather than trusting the config to mean what it says.

Not doing: changing which typefaces the brand uses. This is about what is
fetched, never about what is drawn — see the `apply-the-brand` skill.

## Acceptance

- A day page, the landing page and `/agent` each load with no
  "preloaded but not used" warning in the console.
- The pages still paint in the same faces they do now — compare against
  `/docs/branding/identity` before and after.

