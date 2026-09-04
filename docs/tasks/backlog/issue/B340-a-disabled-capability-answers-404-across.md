---
id: B340
title: A disabled capability answers 404 across every gated route, hiding a real refusal as no-such-route
type: ISSUE
priority: medium
complexity: low
area: capabilities, api
found: "2026-09-04T19:29:50Z"
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
