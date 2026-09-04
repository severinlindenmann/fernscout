# W27 — private / public / guest

## Why

The requested model is three words: **private**, **public**, **guest**.

| | Who can read it |
| --- | --- |
| `private` | only the people who took the trip (W26) |
| `public` | everyone |
| `guest` | invited guests, plus the people who took the trip |

## Against what exists

Today: `visibility: public | unlisted | password`, plus a separate
`costsVisibility: public | guests`.

The two models are not the same axis. `unlisted` and `password` are *how* you
get in; `private`/`guest` is *who* is let in. The plan is to make the new three
the primary axis and keep the old words working:

| Old | Reads as | Why keep it |
| --- | --- | --- |
| `public` | `public` | identical |
| `password` | `guest` | a password is how a guest proves it |
| `unlisted` | `public` + `listed: false` | being reachable by link and being advertised are different things, and conflating them is how "unlisted" stops meaning anything |

`listed:` becomes its own boolean, which is what it always was.

**An unrecognised value still reads as the most private option**, now
`private` rather than `password`. A typo must never publish a trip.

## Work

1. `TripVisibility = "private" | "public" | "guest"`, plus `listed: boolean`.
2. A compatibility layer in `lib/trips.ts` mapping the old three, with a
   deprecation note in the parse warning.
3. `lib/access.ts` — `mayReadTrip` consults the people list for `private`, and
   guests-or-people for `guest`.
4. Every gated page already calls `mayReadTrip` (see `test/trip-gate.test.ts`),
   so the surface does not change.
5. `costsVisibility` keeps working and keeps its own axis.

## Acceptance

- A `private` trip is 404/gated for a stranger and open to a person on it.
- A `guest` trip opens for an approved contact and for a person on it.
- `unlisted` keeps its meaning through the compatibility layer.
- The gate tests still pass unchanged.
