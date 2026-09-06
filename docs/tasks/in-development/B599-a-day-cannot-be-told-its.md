---
id: B599
title: A day cannot be told its photographs or its place are unrecorded after it exists
type: ISSUE
priority: medium
complexity: low
area: api, days
found: "2026-09-06T14:37:03Z"
started: "2026-09-06T14:54:21Z"
session: ac8af30e-815d-4843-a94d-cf061a70269c
claimed: "2026-09-06T14:54:21Z"
---

# B599 — A day cannot be told its photographs or its place are unrecorded after it exists

## Why

Split out of B597 on 2026-09-06, once the contract had been read properly.

A day may answer three ways about its photographs and its place: `lat`/`lng`
or pictures (the positive answer), `false` (*there were none*), and
`"unknown"` (*there were some and nobody has them to hand*). `openapi.json`
documents `false` as create-only for both fields, deliberately and with a
reason. It documents no such limit on `"unknown"` — and for `photos` it says
the opposite:

> `"unknown"` is the third answer: there are pictures somewhere and nobody has
> them to hand. **They can be added later; the day does not have to wait.**

But `PATCH .../days/<slug>` refuses the whole field, because neither `photos`
nor `coordinates` is in `EDITABLE_DAY_FIELDS` (`lib/api/entries.ts`). So
`{"photos": "unknown"}` on an existing day is a 400, the same as
`{"photos": false}`, and nothing distinguishes the answer that is create-only
by design from the one that is not.

`costs` is in that list and takes all three answers on a PATCH. The three are
presented to a writer as one idea — `without:` and `unrecorded:` each take any
of them — so a day can say "the money is gone" after the fact and cannot say
"the pictures are gone".

The realistic case is ordinary: a day is written and published; weeks later the
owner accepts that the photographs from that afternoon are lost. There is no
call that records it.

**Low stakes, and worth being clear about that.** Nothing is broken today that
this blocks — B597 fixes the failing publish entirely on the client side, by
not re-sending the create-only `false`. This is about an answer a person can
give on one field and not on two others, for no stated reason.

## Work

- Add `photos` and `coordinates` to `EDITABLE_DAY_FIELDS`, accepting
  `"unknown"` only. `false` stays refused on this route — that is the
  documented, deliberate half, and this ticket does not widen it.
- The refusal for `false` on PATCH should then say *why* — that it is an answer
  given when a day is written — rather than listing the fields it takes and
  leaving the caller to infer that theirs is not among them. The current
  message also mentions draft/published status, which has nothing to do with
  `photos`; that reads as a generic body attached to a specific refusal.
- `openapi.json`'s `DayEdit` should differ from `Draft` where the routes
  differ, so a client can tell the two apart without provoking a 400.
- Check what a `"unknown"` written this way does to a trip that `tracks`
  photos: `incomplete_day` (422) is refused at publish for a day that says
  neither, and this has to count as saying something.

Not doing: allowing `false` on an existing day.

## Acceptance

- `PATCH .../days/<slug>` with `{"photos": "unknown"}` returns 200 and the day
  reads back carrying it; the same with `coordinates`.
- `PATCH` with `{"photos": false}` is still refused, with a message that says
  it is an answer given at creation and names what to do instead.
- A day switched to `"unknown"` on a trip that tracks photos still publishes.
- `openapi.json` shows the difference between `Draft` and `DayEdit` for both
  fields, and `npm run verify` is green.
