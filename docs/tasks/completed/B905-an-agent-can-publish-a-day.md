---
id: B905
title: An agent can publish a day and cannot take it down again
type: ISSUE
priority: high
complexity: low
area: api, entries
found: "2026-09-08T04:57:37Z"
started: "2026-09-08T12:09:15Z"
merged: "2026-09-08T12:17:36Z"
completed: "2026-09-09T16:46:53Z"
---

# B905 — An agent can publish a day and cannot take it down again

## Why

`DayEdit` in `lib/api/openapi.ts` carries `title`, `date`, `content`, `costs`,
`weather` and `test`. It carries no `status`.

So `POST …/days/<slug>/publish` puts a day on the site, and **nothing in the
documented contract takes it off again.** Taking a day down exists only at
`POST /api/helper/<user>/day/unpublish` — cookie-only, undocumented, added by
B816 for the browser.

An agent working over the network can publish and cannot unpublish. That is a
gate backwards: the reversible half of the pair is the half that is missing,
and the person most likely to need it is the one whose friend has just asked to
come out of a photograph.

AGENTS.md's own framing makes it sharper — publishing is deliberately two calls
so a person decides. Undoing that decision should not require a browser.

Found by mapping every operation to a chat shape, 2026-09-08.

## Work

Add unpublish to the contract. Either a `status` field on `DayEdit` that may
only ever move `published → draft`, or an explicit
`POST …/days/<slug>/unpublish` mirroring the publish route — the second is
probably clearer, since publishing is a route rather than a field and the pair
should look alike.

`unpublishEntry` already exists (`lib/api/entries.ts`, B816) with the same
`fileUnchangedSince` guard publishing uses, so this is a door onto work that is
done.

`/agent.md` and `lib/api/openapi.ts` change with it, and the publish
documentation should name its opposite.

## Acceptance

An agent that published a day can take it down again, and the guide says so
beside the publish call.
