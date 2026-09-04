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

Two halves, and the first is safe to do immediately.

1. **Make `405` say something.** A route that refuses a verb should name the
   verbs it has and, where it is a common wrong guess, the route that does have
   it. Find how Next surfaces an unimplemented method here and whether it can
   carry a body at all; if it cannot, the answer may be an explicit handler on
   the routes agents demonstrably guess at. Keep it cheap — this is a message,
   not a framework.
2. **Decide whether an agent may change a journal's capabilities**, and record
   the decision either way. It is genuinely open, which is why this is not
   already built:
   - *For:* the agent is the editor and there is no other interface. A setting
     no door can reach is a setting only SSH can fix, which is B153's complaint
     and not a good place to be.
   - *Against:* capabilities decide what the software *is* for that journal —
     turning `auth` or `contacts` off can lock an owner out of their own
     journal, which is precisely why those two are forced on at creation. A
     token that can disable authentication is a token that can strand its
     owner.
   - A middle answer worth weighing: allow the harmless subset (`costs`,
     `reactions`, `photobook`, `postcards`) and refuse the two that gate access
     (`auth`, `contacts`) with a sentence saying why — which is the same shape
     as `JOURNAL_FIELD_REFUSALS` already uses for `owner.email` and
     `baseCurrency`.
3. Whatever is decided, **document it**: an agent asked to turn a page off must
   find either the call or the sentence saying it cannot, and must never again
   have "tell them to use the web UI" as its best remaining move. Both
   documents.

## Acceptance

- A wrong verb on the trip and journal routes returns a body naming what is
  allowed.
- An agent can either change a journal's features through a documented call, or
  read that it cannot and why — and the reasoning for which is written down.
- Nothing an agent can call can turn off `auth` or `contacts` for a journal it
  holds a token for.
- `npm run build`, `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`.
