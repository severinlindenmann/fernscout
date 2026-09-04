---
id: B293
title: A journal's features cannot be changed by any door, and the route that refuses says only 405
type: ISSUE
priority: medium
complexity: medium
area: api, config, capabilities
found: "2026-09-04T13:35:47Z"
started: "2026-09-04T14:41:16Z"
merged: "2026-09-04T15:05:26Z"
completed: "2026-09-04T21:54:16Z"
---

# B293 — A journal's features cannot be changed by any door, and the route that refuses says only 405

## Why

Reported 2026-09-04 by an agent asked to turn off a trip's costs page. It tried
`PATCH /api/v1/<user>/trips/<trip>` and `PATCH /api/v1/<user>`, got `405` from
both with no body, and — having no way forward — told its owner to *"do it
manually via the web UI"*.

There is no such web UI. That is the same invention as the *"manually upload"*
in B259: an agent with no correct call available offers the owner a route that
does not exist. So this is two defects, and the second is the cause of the
first.

**`features` is writable by nothing.** `JOURNAL_PROFILE_FIELDS`
(`lib/journals.ts:692-702`) is the whole accepted list for
`PATCH /api/v1/<user>/config` — title, tagline, visibility, startLocation,
units, locales, defaultLocale, displayCurrencies, manualRates. `features` is
not on it, and there is no other endpoint, no MCP tool and no page. This is
already on the record inside the codebase: B153's note in `lib/journals.ts`
says that with `contacts` off, *"there was no endpoint, tool or page anywhere
that could change it — the only way in was to hand-edit this file over SSH."*
That was written about why two capabilities are forced on at creation. It is
still true of every other capability, for every journal, forever.

**A `405` with no body tells the caller nothing.** Every other refusal in this
API names what is wrong and often what to do instead. `405` from a route that
has only `DELETE` leaves an agent unable to distinguish "wrong verb", "wrong
path" and "not implemented" — and guessing between those three is exactly what
burned the calls here.

Worth separating from the above: **there is no per-trip costs switch at all.**
Costs are a journal-level capability plus the presence of `costs.md` in a trip.
So "turn off the costs page for this trip" may have no answer other than "do
not write a `costs.md`" — which is a fair answer and is not written anywhere.
B267's UI half is the related complaint: the nav offers Costs on a journal with
no budget at all.

## Work

**Built on 2026-09-04, and the world moved while this sat in the backlog.** Two
tickets landed first and turned the main complaint from "you cannot" into "here
is how": B267 made the costs page follow the data, and B295 built the costs
door. So the sentence an agent needed was never going to be *"this is UI-only"*
— it is *"write a budget to give the page, DELETE it to take the page away"*.
MCP is also gone (B298), so there is one door, not two.

What was built:

1. **`PATCH` handlers on the two routes an agent was observed guessing at**,
   each answering `405` with `Allow: DELETE` and a body naming what the route
   has and where the likely intention actually lives.
   `PATCH /api/v1/<user>` points at `…/config`; `PATCH /api/v1/<user>/trips/<trip>`
   points at the budget, the day and the media doors below it, and says a
   trip's own fields are `trip.md` and the owner's own edit. Next answers an
   unimplemented method with a bare `405` and no body, so an explicit handler
   is the only way to say anything — two of them, not a framework. A third
   route gets the same treatment when a third guess turns up.
2. **`NOT_WRITABLE` in `lib/api/agentCopy.ts`**, rendered into both generated
   documents beside the budget question. It carries the two facts and the one
   prohibition: `features` are not writable by any door and why (`auth` and
   `contacts` are how an owner gets back in, and a token must not shut the door
   it came through — B153); a trip has no costs *switch*, the page follows the
   data; and if neither is what was asked for, say so and stop, because there is
   no web form, no CMS and no upload page to send anybody to instead.
3. **`features` stays unwritable**, deliberately.

Not in scope, and no longer needed for this complaint: an API for capabilities.
## Acceptance

- A wrong verb on the trip and journal routes returns a body naming what is
  allowed.
- An agent can either change a journal's features through a documented call, or
  read that it cannot and why — and the reasoning for which is written down.
- Nothing an agent can call can turn off `auth` or `contacts` for a journal it
  holds a token for.
- `npm run build`, `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`.
