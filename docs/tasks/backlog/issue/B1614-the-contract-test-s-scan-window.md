---
id: B1614
title: "The contract test's scan window could not see cookie-only doors, so a live error code read as dead"
type: ISSUE
priority: medium
complexity: low
area: Testing
found: 2026-09-12T00:00:00Z
---

## Why

`test/openapi-contract.test.ts` has two directions, and they are both good:
every code a route answers with must be in `ERROR_CODES`, and nothing in
`ERROR_CODES` may be answered by no route. The second is what stops the
catalogue filling with words nobody returns.

Its scan window was `app/api/v1` + `app/api/auth` + a short list of modules
whose refusal strings reach a caller through a variable. It never covered
`app/api/helper/**` or the owner's own page routes under `app/[user]/`.

That blind spot caused a real deletion. During the v2 media work (B1613) the
v1 media route was removed. It was the only speaker of `expected_src` *inside
the scan window* — so the test reported `expected_src` as documented and never
returned, and an agent reading that failure deleted the code. Three live
routes still answer with it:

- `app/api/helper/[user]/day/remove-photo/route.ts:49`
- `app/api/helper/[user]/day/media/route.ts:111`
- `app/[user]/trips/[trip]/day/[slug]/photos/route.ts:134`

A caller of any of those would have received a word no document defines —
which is exactly the B540 failure the whole file exists to prevent, arriving
through the test meant to prevent it.

**Fixed in B1613's merge**, so this ticket is the record and the follow-up,
not the fix.

## What was done

The `spoken` set — the one used for the dead-code direction — now also walks
`app/api/helper` and `app/[user]`. The `answered` set deliberately does **not**:
those are cookie-only browser internals outside the published contract, and
holding them to "every code you answer with must be documented" would demand
an `ERROR_CODES` entry for every refusal in forty files nobody outside ever
reads. A code they answer with is not dead; a code they invent is their own
business.

## Work

What remains is the question this exposed rather than the patch:

- **Should the cookie-only doors be held to the published vocabulary too?**
  Right now `/api/web` (step 5 of the v2 migration) will inherit these routes.
  If those refusals are going to be part of a documented surface, `answered`
  should widen to match at that point — and that is a real piece of work, not
  a one-line change.
- A cheaper guard in the meantime: a test that fails when a route under
  `app/api/helper/**` answers with a code that is *neither* in `ERROR_CODES`
  *nor* in a small allowlist of helper-only words. That catches a helper
  inventing a word without demanding the whole surface be documented.

Not doing: widening `answered` now. It would fail the build on forty files
this migration has not reached yet, for a contract decision nobody has taken.

## Acceptance

- A code spoken only by a cookie-only route is not reported as dead.
  (Done — `expected_src` is restored and the suite is green.)
- A decision recorded, when step 5 lands, on whether `/api/web`'s refusals
  join the published vocabulary.
