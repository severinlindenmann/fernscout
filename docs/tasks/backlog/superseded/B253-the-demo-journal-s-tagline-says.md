---
id: B253
title: The demo journal's tagline says four journeys and the count beside it says five
type: ISSUE
priority: low
complexity: low
area: content, demo
found: "2026-09-04T10:01:21Z"
superseded: the repository was already right; what this observed was deploy drift — see B131
---

# B253 — The demo journal's tagline says four journeys and the count beside it says five

## Why

> **Superseded, 2026-09-04.** The premise does not hold against the
> repository. `content/example/config.json` has read **"Five journeys"** since
> `e576105` on 2026-09-01 — the same commit that added `japan-2027` — so the
> tagline and the count have never disagreed on `main`. What
> `/documentation.txt` served was a live instance running content older than
> `main`, which is not a content bug at all: it is the drift **B131** is about,
> and this is the first observation of it from outside. Nothing to fix here.

`/documentation.txt` on the live instance renders the demo journal's own
tagline beside a count the server computes:

```
- [Fernscout Demo](https://fernscout.ch/example/documentation.txt): Four
  journeys, to show what this thing does — 5 public trips
```

"Four journeys" is a hand-written string in `content/example/config.json`.
The "5 public trips" is counted from disk. `japan-2027` was added after the
tagline was written and nothing went back for it, so the one line this
instance uses to introduce the demo journal contradicts itself inside a dash.

Small, and it lands where B113 says it costs most: `/documentation.txt` is what
`agent.md` points a stranger's agent at to learn what is on this instance.

Found while verifying B113 (the same trip's absence, now resolved).

## Work

Decide whether the tagline should carry a count at all. A number written by
hand next to a number counted from disk will drift again the next time a trip
is added — "A few journeys, to show what this thing does" cannot.

## Acceptance

- `/documentation.txt` does not state two different trip counts in one line.
- Adding a sixth trip to the demo journal does not make it wrong again, or the
  file says why that is acceptable.
