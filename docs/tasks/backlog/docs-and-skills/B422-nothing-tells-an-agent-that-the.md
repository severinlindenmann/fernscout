---
id: B422
title: Nothing tells an agent that the owner's pages are cookie-only, so a bearer token that works on every API call renders none of them
type: DOCS
priority: low
complexity: low
area: agent guide, contacts
found: "2026-09-05T11:30:00Z"
---

# B422 — Nothing tells an agent that the owner's pages are cookie-only, so a bearer token that works on every API call renders none of them

## Why

Found by a verification agent during the 2026-09-05 live campaign, after it
had spent several turns trying to see a banner it had itself caused.

`app/[user]/contacts/page.tsx` calls `isOwner(username)` with no `request`
argument, so the owner's contacts page authenticates from a **cookie session
only**. The same agent token that drives every `POST /api/contacts/admin` call
successfully renders nothing at all there.

That is the correct design and is decision 24 restated — reading the site on
your phone must not put a rewriting credential in your pocket, and the
converse holds too: a bearer token is for the API, not for pages. The problem
is only that nothing says so. `AGENTS.md` describes the two credential kinds
and that `resolveSession()` keeps them apart; it does not say the consequence
an agent actually meets, which is "you can create the state but you can never
look at the page that shows it".

Cost is a verification agent's time, repeatedly, and a class of acceptance
line that reads as checkable over the API and is not — B384's "the owner's
page shows an invitation is outstanding" was reported as inferred from data
plus source rather than observed, which is the honest answer and also a weaker
one than the ticket wanted.

## Work

One paragraph in `AGENTS.md` under "The network doors", and a matching line in
`/agent.md`: an agent token reaches `/api/…` and never a rendered page; the
owner's own pages need a browser session, which an agent can only obtain the
way a person does. Say which surfaces this covers — `/<user>/contacts`,
`/<user>/me` — so the list is checkable rather than folkloric.

Then the consequence for whoever writes tickets: an acceptance line about
what a *page shows* cannot be closed by an agent over the API, and should
either name the browser explicitly or be written against the API state that
drives the render.

The testing skill should say the same thing where it tells an agent to verify
a ticket, so it is met before the wasted turns rather than after.

## Acceptance

`AGENTS.md` and `/agent.md` both state the rule and name the owner-only pages.
An agent reading either before starting knows, without trying, that it needs a
browser for a page and a token for an API.
