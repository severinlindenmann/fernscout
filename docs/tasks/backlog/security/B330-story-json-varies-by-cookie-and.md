---
id: B330
title: story.json varies by cookie and does not say so, so a browser cache can serve one reader's drafts to the next
type: SECURITY
priority: medium
complexity: low
area: story, caching, drafts
found: "2026-09-04T20:49:33Z"
---

# B330 — story.json varies by cookie and does not say so, so a browser cache can serve one reader's drafts to the next

## Why

Found while building B327, and it predates it.

`app/[user]/story.json/route.ts` answers with:

```
Cache-Control: private, max-age=60, stale-while-revalidate=600
```

and no `Vary`. The body varies by cookie in two ways: `showCosts` comes from
`mayViewCosts(trip)`, and `includeDrafts` comes from `draftsVisibleTo(trip,
request)`. So the same URL returns different content to different sessions and
the response never says which input it was keyed on.

`private` does the important half — a shared cache, a CDN or a proxy will not
store it, so there is no cross-user leak over the network. What it does not
cover is **the browser's own cache, which is shared between sessions on one
device**. The cache key is the URL. Sign out, sign in as somebody else, and for
up to sixty seconds — or ten minutes under `stale-while-revalidate` — a request
for the same window of days can be answered from what the previous reader was
handed. On a family tablet or a shared laptop, that is the owner's unpublished
prose served to a guest.

This existed before B327: the owner's drafts and a private trip's costs were
already in that cache. What B327 changes is the size of the set — anybody on a
trip now gets drafts too, so there are more sessions whose view is worth not
leaking. That is a reason to fix it, not the origin of it.

Filed as SECURITY rather than ISSUE because the failure is disclosure of
content the software otherwise works hard to withhold, and the fix is one
header. Not high priority: it needs a shared device and a sign-in within the
window, and `private` already rules out the remote-cache version.

## Work

Send `Vary: Cookie` from this route. That is the honest statement of what the
response depends on, and it makes the browser key its cache on the session as
well as the URL.

Then check the rest, because one route with the right header and four without
is the same bug with a smaller blast radius. Any route or page that both
(a) varies its body on a session and (b) sets a `Cache-Control` that permits
storage needs the same treatment. `app/[user]/media/[...path]/route.ts` is
worth a look first — it reads with `includeDrafts: true` and serves a draft
day's photographs.

Consider whether sixty seconds of `max-age` plus ten minutes of
`stale-while-revalidate` is worth keeping at all on a response this
session-dependent. The comment argues for it — paging back and forth over the
same stretch should cost one request — and that reasoning is sound; `Vary`
keeps the benefit and removes the hazard, so prefer the header over shortening
the window.

Not doing: any change to who may see drafts or costs. B327 settled the first
and `mayViewCosts` the second; this is only about what the response says about
itself.

## Acceptance

- `GET /<user>/story.json` carries `Vary: Cookie`.
- A test asserts it, and asserts it beside the `Cache-Control` header so the
  two are read together.
- Every other route that serves session-dependent content with a storable
  `Cache-Control` either carries `Vary: Cookie` or is named in this task with a
  reason it does not need one.
