---
id: B1104
title: A PATCH press sends no body, so every card that edits a trip or a day's words fails
type: ISSUE
priority: high
complexity: low
area: components/HelperAsk.tsx
found: "2026-09-09T16:27:50Z"
merged: "2026-09-09T16:38:34Z"
---

# B1104 — A PATCH press sends no body, so every card that edits a trip or a day's words fails

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

`components/HelperAsk.tsx`, in `send()`:

```ts
body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
```

A PATCH press therefore sends `content-type: application/json` and no JSON.
Every route on the other side opens with `await request.json()`, which throws,
so the answer is `invalid_json` and the screen says *"Something in that press
did not arrive properly. Say it again and I will make a fresh one."* — about a
card that was entirely correct. Saying it again produces another card that
fails the same way.

Five tools press with PATCH, and one of them is the product:

| tool | what a press was meant to do |
| --- | --- |
| `set_day_words` | **write the words of a day** |
| `edit_trip` | a trip's title and dates |
| `set_visibility` | who may read a trip |
| `trip_people` | add somebody to a trip |
| `trip_tracks` | what each day is asked for |

`set_day_words` has pressed with PATCH since B898, so this has been live for a
fortnight on the single most-used write there is.

## How it survived 6,303 tests

Two habits, each defensible on its own:

- Every press test calls a **route handler directly**, with a body it built
  itself. Those prove the server and never execute the component's `fetch`.
- `test/helper-chat.test.tsx`'s fetch stub records
  `init?.body ? JSON.parse(init.body) : {}`. A missing body becomes `{}` and
  every assertion about what was sent still passes — the harness papered over
  the one defect it was placed to catch.

It was found by an agent pressing "Save these changes" on the live site and
being told, twice, that its press had not arrived properly.

## Work

Send the body on every verb; there is no press here that should have an empty
one, since a proposal's arguments *are* the press (B900).
`test/helper-press-body.test.tsx` records the **raw** body and asserts it is a
string, which fails on the old line and passes on the new one — checked in
both directions.

## Acceptance

Rename a trip through the conversation on a running instance and see the new
title on the trip. Then write a day's words and press — the same path
`set_day_words` takes.
