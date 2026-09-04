---
id: B331
title: A journal's own document never mentions invites, so an agent told its owner to use a dashboard that does not exist
type: ISSUE
priority: high
complexity: low
area: agent docs, invites
found: "2026-09-04T18:53:16Z"
started: "2026-09-04T19:26:10Z"
merged: "2026-09-04T19:36:00Z"
completed: "2026-09-04T21:54:18Z"
---

# B331 — A journal's own document never mentions invites, so an agent told its owner to use a dashboard that does not exist

## Why

Reported 2026-09-04. An owner asked their agent to invite `peter@severin.io` as
a guest. The agent, holding a full owner token for `viki`, refused twice:

> "Ich kann das nicht über die API machen – nur du als Eigentümer kannst
> Einladungen ausstellen."
> …then, pushed: "Der Endpunkt existiert nicht."

and invented a browser flow — *"Im Journal-Dashboard findest du einen 'Invite'
oder 'Contacts' Bereich"* — which is the third time today an agent with no
correct call in reach has offered its owner an interface that does not exist
(B259's "manually upload", B293's "do it via the web UI").

**There is no code defect.** Investigated end to end against the live site and
with a throwaway fixture:

| Caller | Status | |
| --- | --- | --- |
| owner agent token, `contacts` on | **`201`** | invite created, `url` returned |
| owner agent token, `contacts` off | `404` | `contacts_disabled`, with an explaining body |
| trip-scoped token, or none | `403` | `forbidden`, naming why |

`curl` against `https://fernscout.ch/api/v1/viki/invites` with no token returns
`403`, not `404` — proof `contacts` is on for that journal — and
`test/invite-links.test.ts` already carries a regression test for exactly this
shape (B153: *"a journal created through the API can share itself"*).

**What was missing is the safety net.** `GET /<user>/documentation.txt` — which
AGENTS.md's own table calls *"one journal's own summary"*, and which is the
document an agent working on an established journal would read — **never
mentions invites, contacts, guest links or buddy links at all.**
`userDocumentation()` (`lib/api/documentation.ts:338-418`) lists trips, days,
editing, drafts, deleting, search, feed and export, and nothing about letting
anybody in. It never imports the invite copy that `agentGuide()` and
`instanceDocumentation()` both render.

And the site-wide document's only mention is **coupled to publishing**.
`GUEST_LINK_OFFER` (`lib/api/agentCopy.ts:227-231`, B317) reads *"Once a trip
is published, offer a guest link…"* and sits inside the first-time onboarding
script, after the worked `/publish` example. That is the right place for *when
to proactively offer* it. It is the wrong and only place for *that the
capability exists* — an agent asked to invite somebody, on a journal that
already exists, has no reason to re-read a "create a brand-new journal"
walkthrough.

`/agent.md` documents it properly, with a whole "Letting other people in"
section and a worked example. So the answer was reachable and the agent did not
reach it — which is the failure a per-journal summary exists to prevent.

## Work

Three things, smallest first.

1. **Name the invites endpoint in `userDocumentation()`** — one bullet in the
   existing `## Endpoints` list (around lines 397-409):
   `POST /api/v1/<user>/invites` with `{"kind":"guest"}` or
   `{"kind":"buddy","trip":"<id>"}`, owner only. This alone would have stopped
   it.
2. **Decouple "this exists" from "offer it now."** Keep `GUEST_LINK_OFFER`
   where it is, and make the capability itself findable outside the onboarding
   script — a line in the endpoint list of `instanceDocumentation()`, or a
   heading. An agent searching either document for "invite" should hit
   something.
3. **A disabled capability should not answer `404`.** `guard()` in
   `app/api/v1/[user]/invites/route.ts:104` checks the `contacts` capability
   *before* the owner check at `:115`, so a journal with contacts off answers
   `404` to everybody — body explains it, status says "no such route". That is
   not what happened on `viki`, but it is the same misreading the agent made,
   waiting for the case where the capability really is off. Consider `403` or
   `409` with the same body, and check whether any other capability-gated
   route does the same thing — if several do, this becomes a convention
   question rather than a one-line change, and should be captured as one
   rather than fixed piecemeal here.

Not in scope: whether the agent should have tried before refusing. Nothing in
the code can make it, and B259's "say so and stop" instruction already covers
inventing an interface — this ticket is about there being an answer to find.

## Acceptance

- `GET /<user>/documentation.txt` names the invites endpoint.
- Searching either generated document for "invite" finds the capability
  without reading the onboarding script.
- A disabled `contacts` capability does not answer with a status that means
  "no such route", or it is recorded why it still does.
- `npm run build`, `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`.

## What was built

Items 1 and 2 done; item 3 deliberately not touched here — see below.

1. **`userDocumentation()`** (`lib/api/documentation.ts`, `## Endpoints` list)
   gained one bullet naming `POST /api/v1/<user>/invites`, both call shapes
   (`{"kind":"guest"}` and `{"kind":"buddy","trip":"<trip-id>"}`), and that it
   is owner-only.
2. **`instanceDocumentation()`** gained a new heading, `## Letting other
   people in`, between the onboarding walkthrough (`## Then`, which still
   carries `GUEST_LINK_OFFER` where it always did — right place to *offer*
   one once a trip is published) and `## Journals`. It names the invites
   endpoint, both call shapes, and points at `/agent.md`'s own "Letting other
   people in" section — findable by an agent that is not reading the
   create-a-journal script at all, which is the gap the incident report
   describes.

   Both are covered by new tests in `test/agent-interface.test.ts`:
   `"a journal's own document names the invites endpoint"` and `"the instance
   document has its own heading for invites, not only a mention inside
   onboarding"`.

3. **Not changed.** Investigated first, per instruction: is `contacts` off
   answering `404` (`app/api/v1/[user]/invites/route.ts:104-114`) a one-off or
   a convention? It is a convention, followed at least four times —
   `invites/[id]/route.ts:27-28` (`contacts_disabled`, `404`),
   `keys/route.ts:32-34` (`auth_disabled`, `404`), and `reactions/route.ts`,
   whose own comment (line 35) names this "the idiom the contacts routes
   already use" and cites B165 — the ticket that settled `404` for the costs
   pages on the same reasoning ("what every other capability-gated route
   already does" + "the capability is journal-wide and reader-independent, so
   a 404 leaks nothing"). Changing `invites` alone would make the codebase
   *less* consistent, not more correct, and B165's own reasoning is a real
   argument, not an oversight — it deserves being weighed once, for every
   route the shape appears in, rather than decided piecemeal by whichever
   ticket happens to touch one of them. Captured as **B340**.

## Evidence

- `npx vitest run test/agent-interface.test.ts` — 69 passed (was 67), including
  the two new tests above.
- `npm run verify` — see final report.
