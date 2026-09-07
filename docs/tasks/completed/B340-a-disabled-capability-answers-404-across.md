---
id: B340
title: A disabled capability answers 404 across every gated route, hiding a real refusal as no-such-route
type: ISSUE
priority: medium
complexity: low
area: capabilities, api
found: "2026-09-04T19:29:50Z"
started: "2026-09-07T11:06:13Z"
merged: "2026-09-07T11:32:26Z"
completed: "2026-09-07T13:09:09Z"
---

# B340 — A disabled capability answers 404 across every gated route, hiding a real refusal as no-such-route

## Why

Raised while working B331. That ticket's Work item 3 asked whether
`app/api/v1/[user]/invites/route.ts:104-114` answering `404 contacts_disabled`
for a disabled `contacts` capability — before the owner check, so it is `404`
to everybody, not just to the owner — should instead be `403` or `409`, since a
`404` reads as "no such route" and the agent this ticket describes did read it
that way once, in prose, before hitting the real (`contacts` on) case.

It is not a one-line fix. The same shape is deliberate and repeated:

- `app/api/v1/[user]/invites/route.ts:104-114` — `contacts_disabled`, `404`.
- `app/api/v1/[user]/invites/[id]/route.ts:27-28` — same, `404`.
- `app/api/v1/[user]/keys/route.ts:32-34` — `auth_disabled`, `404`.
- `app/api/reactions/route.ts:35-38,87-89` — documents itself as following
  "the idiom the contacts routes already use", `404`.
- `app/[user]/contacts/page.tsx` and `app/[user]/i/[token]/page.tsx` — pages,
  not API routes, but `notFound()` for the same reason.
- `docs/tasks/completed/B165-turning-the-costs-capability-off.md` settled this
  for the costs pages on the same basis: "It is what every other
  capability-gated route in this codebase already does" and "the capability is
  journal-wide and reader-independent, so a 404 leaks nothing."

So this is a convention, decided once (B165) and followed at least four times
since, not a bug local to `invites`. Changing one route's status code without
changing the rest would make the codebase *less* consistent, and B331 chose not
to touch it for that reason.

What is still worth asking, in one place, for all of them at once: is `404`
actually the right choice for a route an *authenticated* caller reaches
believing the capability is on? B165's reasoning is about an anonymous reader
of a public page, where a 404 leaking nothing is the whole point. `invites`
and `keys` are hit by an agent holding a live owner token — a caller who is
by definition not a stranger probing for what exists — and for that caller a
`403`/`409` naming the real reason ("this journal has not turned contacts on")
is arguably more honest than "no such route," with no privacy given up: an
owner's own agent already knows the journal exists.

## Work

- Decide, instance-wide, whether an *authenticated* caller hitting a
  capability-gated API route (as opposed to an anonymous reader of a public
  page) should see `404` or a `403`/`409` naming the disabled capability.
  Weigh B165's leak-nothing argument (right for a public page reader) against
  whether it still holds for a caller who already proved who they are.
- If the answer is to change it: change it everywhere the shape appears
  (`invites`, `invites/[id]`, `keys`, `reactions`), not just where it was
  first noticed, and update whichever document states the convention.
- If the answer is to keep `404`: write down why, once, somewhere a future
  agent reading one of these routes in isolation will find it — a comment
  pointing at this ticket's reasoning would have stopped B331's Work item 3
  from being asked as if it were new.
- Out of scope: the *page* routes (`app/[user]/contacts/page.tsx` etc.),
  which are read by anonymous browsers and for which B165's reasoning applies
  without the caveat above.

## Acceptance

- A decision is recorded — either a code change applied consistently across
  every API route with this shape, with a test asserting the new status, or a
  comment/doc explaining why `404` stays and pointing future readers at this
  reasoning.
- `npm run verify` passes.

## Decision

Two things worth knowing before the verdict, found while reading the actual
guard functions rather than trusting the Why's summary of them:

1. **The capability check runs before any auth check, today, in all four
   places.** `!getUser(username) || !isEnabled(...)` is the *first* line of
   every guard — before `isOwner`, before any token is even read. So today's
   `404` is not reached only by "an agent holding a live owner token"; it is
   reached by absolutely anybody, including a caller with no credential at
   all, which the Why's framing undersold.
2. **`/api/health` cannot answer this for an owner's own agent, even with a
   live token.** The per-journal `journals` block — the only place a
   capability's *narrowing for one journal* is reported — needs a separate
   operator secret (`HEALTH_TOKEN`), checked by `mayReadDetail()`
   (`app/api/health/route.ts`), that an owner's agent bearer token or guest
   cookie does not satisfy. So the premise that "`/api/health` already
   explains why something is off" only holds at the *server-wide* toggle; a
   journal that narrowed a server-enabled capability off for itself gives an
   authenticated owner no way to ask why, short of this ticket's fix.

That second point is what tips the decision: B165's "no privacy given up"
argument for public pages is right, but for `invites`/`keys` it was being
applied to a caller who has no other way to learn the reason at all.

**Decision: reorder the check, don't just change the number.** For
`invites`, `invites/{id}` and `keys` — the three *owner-only* routes in the
list — check `isOwner` **before** the capability, not after. `isOwner`
already answers `false` identically for a journal that does not exist and
one that exists but is not this caller's (`lib/contacts/session.ts`), so that
check alone is the whole of B117's guarantee: every caller without proof of
ownership — including one with no credential — gets the same `403 forbidden`,
whatever the capability's state and whatever the journal's name. Only once
ownership is *proven* (which, by construction, means the journal is real) is
the capability checked, and now a `409` names the real reason
(`contacts_disabled` / `auth_disabled`) instead of folding it into `404`.

This is not "authenticated vs anonymous" as the Why framed it — an
authenticated non-owner (or a trip-scoped token) still gets the same `403` a
stranger gets, because being logged in as *somebody* is not the same as
having proven you own *this* journal. The line is ownership, which is exactly
the population B165's "no privacy given up" reasoning actually applies to:
having proven you own a journal already tells you, trivially, that it exists.

**`reactions` stays `404`, and this is not an inconsistency — it is the same
principle applied to a route with no ownership gate at all.** Every caller of
`/api/reactions` is anonymous by construction (a voter id in `localStorage`,
not an account), so there is no point in that flow at which "this caller has
already proven the journal is real" ever becomes true. B165's reasoning
applies to it without qualification, same as the *page* routes the Work
section put out of scope. A code comment now says so at the point future
readers will look (`app/api/reactions/route.ts`), naming this ticket, so the
next B331-shaped question stops here rather than being asked again as new.

One incidental improvement, not scope creep: reordering to `isOwner`-first
also closes a smaller, related oracle that existed before this ticket and
that the Why did not mention — a non-owner probing a *capability-enabled*
real journal got `403` (reaching past the old capability check), while a
fake journal or a capability-*disabled* real journal both got `404`. That
distinction — `403` vs `404` telling a stranger with no credential whether a
guessed name is real — is now gone for all three routes: every non-owner
answer is the same `403 forbidden`, unconditionally.

## What the door now tells a caller who is not entitled to the answer

**Not the owner (including no credential at all, including a trip-scoped
token, including a name that names no journal):** exactly what it told them
before, and no more — `403 forbidden`, byte-for-byte identical whether the
journal exists, whether it has the capability on or off, and whether the
caller holds any credential. Nothing about existence, nothing about
configuration.

**The proven owner:** now honest where it used to be evasive. Before: `404`,
indistinguishable from "you mistyped the path" — actionable only by reading
`/api/health` and hoping the answer was a server-wide toggle. After: `409`
with `contacts_disabled` / `auth_disabled` and the same message
`/api/health` gives, which for an owner is strictly more useful and reveals
nothing they didn't already know (they proved they own the journal to get
this answer at all).

## Contract

`lib/api/openapi.ts`: the `GET`/`POST` `/api/v1/{user}/invites`,
`DELETE /api/v1/{user}/invites/{id}` and `GET`/`POST` `/api/v1/{user}/keys`
operations now document `403` as "not this journal's owner — checked before
the capability is, so this also covers a journal that does not exist" and a
new `409` for the proven-owner-capability-off case, replacing the old `404`
line. `/api/reactions` is not `/api/v1/**` or `/api/auth/**`, so it was never
in `lib/api/openapi.ts` and needed no contract change — its reasoning lives
in the route's own docblock instead.

## Tests

`test/capability-owner-refusal.test.ts` (new) — drives the real
`invites` and `keys` routes: the owner with the capability off gets `409` and
the real error code; a non-owner (no token) and a request against a journal
that does not exist answer *identically*, `403`, whether the real journal's
capability is on or off. `test/invite-links.test.ts`,
`test/invite-preapproval.test.ts`, `test/invite-days.test.ts`,
`test/handover.test.ts`, `test/buddy-mail-scope.test.ts` (existing, covering
the same three routes under other scenarios) all still pass unchanged, which
is itself evidence the reorder did not narrow anything a legitimate caller
relied on.
