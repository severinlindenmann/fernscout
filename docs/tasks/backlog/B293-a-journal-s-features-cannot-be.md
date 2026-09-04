---
id: B293
title: A journal's features cannot be changed by any door, and the route that refuses says only 405
type: ISSUE
priority: medium
complexity: medium
area: api, config, capabilities
found: "2026-09-04T13:35:47Z"
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

**Decided by the owner on 2026-09-04, and it makes most of this task go away:
the costs page follows the data, not a switch.** No budget written means the
page and its nav entry are not there; a `costs.md` means they are. So there is
nothing for an agent to toggle, and the authority question below — may a token
disable a journal's capabilities — does not need answering to close the
complaint that produced this ticket.

That presence-driven behaviour is **B267's third Work item** and stays there
rather than being duplicated here. B267 also carries the related half the same
owner reported: the nav offering *Costs* on a journal with no trips at all.

What is left for this task:

1. **Make `405` say something.** A route that refuses a verb should name the
   verbs it has, and where it is a common wrong guess, the route that does have
   it — `PATCH /api/v1/<user>/trips/<trip>` and `PATCH /api/v1/<user>` were both
   guessed here, and the second is `…/config`. Find how Next surfaces an
   unimplemented method and whether it can carry a body; if it cannot, an
   explicit handler on the routes agents demonstrably guess at is the answer.
   Keep it a message, not a framework.
2. **Say in both documents that a journal's `features` are not agent-writable,
   and that the costs page follows the data.** An agent asked to turn a page
   off must find the sentence rather than guess two routes and then invent a
   web UI, which is what happened. Name that failure the way the guide already
   names *"manually upload"* — an interface that does not exist is not a
   fallback.
3. `features` **stays unwritable**, deliberately, and the reason is worth one
   line where the next person will ask: turning `auth` or `contacts` off can
   lock an owner out of their own journal, which is why B153 forces both on at
   creation. A token issued because of an address must not be able to sever the
   path back to it.

Not in scope, and no longer needed for this complaint: an API for capabilities.
If a future case genuinely needs one, the shape to weigh is the harmless subset
(`reactions`, `photobook`, `postcards`) with `auth` and `contacts` refused in
the manner of `JOURNAL_FIELD_REFUSALS` — but do not build it on speculation.
## Acceptance

- A wrong verb on the trip and journal routes returns a body naming what is
  allowed.
- An agent can either change a journal's features through a documented call, or
  read that it cannot and why — and the reasoning for which is written down.
- Nothing an agent can call can turn off `auth` or `contacts` for a journal it
  holds a token for.
- `npm run build`, `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`.
