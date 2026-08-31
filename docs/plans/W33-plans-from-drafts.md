# W33 — Drafts as plans

## Why

`plan.md` holds an intended route as a list of stops. Drafts hold days that
have not happened. A draft dated in the future *is* a plan, and writing the
same place into two files is how they disagree.

## What it does

A draft entry whose date is in the future contributes its `location`, `lat` and
`lng` to the **planned** route — the dashed line on the map — without appearing
anywhere in the story.

```
plan.md route:        stops typed by hand, still supported
future drafts:        stops that already have a day written for them
                      → merged, deduplicated by proximity, ordered by date
```

An agent can then draft the next three days with coordinates, and the map shows
where the trip is going. Publishing one turns it from a dashed stop into a real
one, which is the same transition that already exists for `plan.md`.

## Rules

- Only **drafts**, only **future-dated**, only with coordinates. A future draft
  with no coordinates is a note, not a stop.
- A planned stop within 75 km of a real entry counts as reached — the rule
  `lib/plan.ts` already uses, reused rather than reinvented.
- Visible to the owner as "planned"; invisible to everyone else, exactly like
  the drafts they come from. **A reader must not learn where somebody is going
  next.**

## Work

1. `lib/plan.ts` merges `plan.md` stops with future-dated drafts.
2. `getPlan(ref, { includeDrafts })`, threaded like W26's read options.
3. The map draws planned stops from drafts with the draft styling, and the
   legend says where they came from.
4. The trip countdown for an upcoming trip uses the same merged route.

## Acceptance

- A future draft with coordinates appears on the owner's map as planned.
- The same map, for a stranger, shows only `plan.md`.
- Publishing that draft moves the stop from planned to visited.
- A future draft with no coordinates changes nothing.
