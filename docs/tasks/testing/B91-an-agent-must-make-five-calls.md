---
id: B91
title: An agent must make five calls to learn what it may do here, and the guide does not say to make any of them first
type: FEATURE
priority: medium
complexity: medium
area: api, documentation, agents
found: "2026-09-03"
started: "2026-09-04T12:50:47Z"
merged: "2026-09-04T13:11:09Z"
---

# B91 — An agent must make five calls to learn what it may do here, and the guide does not say to make any of them first

## Why

An agent that has just authenticated knows nothing about the journal it holds a
token for. To find out what is waiting and what it may do, it makes a
scattering of calls: `GET /api/v1/<user>/drafts` for the outstanding drafts
(`app/api/v1/<user>/drafts/route.ts`), `GET /api/v1/<user>/trips` for the trips,
`GET /api/health` for which capabilities this server has on, `GET
/api/v1/<user>/invites` for invites — and there is no single call for "what is
my balance and what does anything cost", because credits do not exist yet
(B89). The guide (`lib/api/documentation.ts`) walks through authenticate → read
→ write and never says: *first, get your bearings.*

Two costs. The obvious one is the round trips. The real one is that an agent
with no cheap way to orient will either skip the orientation — and write into a
journal without noticing three drafts already wait for approval, or try to send
a postcard on a server where `postcards` is off — or reconstruct it call by
call, differently each time. A single status call is the fix asked for:
*"status shows open drafts, available credits, pricing, enabled features on this
server, open trips, journal link, invite link — some basic information so it
does not have to do another call for each step."*

There is a sequencing rule wrapped around it, also asked for: an agent's *first*
call should establish whether it even has a live credential — "checks first if
it has a fresh passcode" — and only then ask for status. Today the guide's
opening move is `POST /api/auth/request`, which is right, but nothing frames the
whole entry as *check credential, then check status, then act*.

## Work

**Add `GET /api/v1/<user>/status`.** Owner token sees everything; a trip-scoped
token sees its own trip's slice and is told plainly that is what it is seeing —
the same scoping `writableTrips`/`writableTrips` already applies in the drafts
and trips routes, so reuse it, do not invent a second rule. One response,
assembled from what already exists:

- **journal**: the public URL, title, visibility, the journal's locale.
- **drafts**: the count and the list the drafts route already builds — each with
  its `publish` call — rather than a second shape of the same data. Factor the
  drafts route's body into something both endpoints call.
- **trips**: open/current/upcoming, day counts, each trip's `visibility` — the
  trip list route already computes this.
- **features**: which capabilities are on *for this journal*, from
  `resolveCapabilities()` (`lib/capabilities.ts`), the same source
  `/api/health` uses, filtered to what an agent can act on (postcards,
  photobook, push, mail…). When one is off, say so; an agent that knows
  `postcards` is off will not build a request that cannot be sent.
- **credits and pricing**: the balance and the price list **when B89 exists**.
  Until then this key is absent, not zero — an absent capability must read as
  absent, not broken (`lib/capabilities.ts`), and a hardcoded price list here
  would be a second source of truth for numbers B89 has not decided. Build the
  endpoint so the credits block slots in without reshaping the rest; do not
  invent the numbers.
- **invites**: the invite-management link, where `contacts` is on.
- **next**: what to do — publish a waiting draft, write a day, nothing.

**Frame the entry sequence in the guide.** Near the top of `agentGuide()`
(`lib/api/documentation.ts:229`), before "Authenticating": the first thing an
agent does is confirm it holds a live token — a `GET /status` that answers `401`
means go get a code; `200` means you are in. Then read status once and work from
it, rather than a call per question. Keep it short; the guide is already long,
and this is a signpost, not a new chapter.

Cache nothing that changes: status is `force-dynamic`, like every other
authenticated route here. It is a convenience view over live data, never a
snapshot.

Not doing: inventing the credit/pricing numbers (B89 owns those), a public
unauthenticated status (the journal's own `documentation.txt` is that), or
folding the drafts and trips routes away — they stay; status summarises them.

Depends on nothing, but the credits and pricing block is empty until B89 lands.
Note that in a closing line so whoever picks up B89 knows to fill it in.

## Acceptance

- `GET /api/v1/<user>/status` with an owner token returns journal, drafts (with
  publish links), trips, enabled features, invites and a `next` — in one call.
- The same call with a trip-scoped token returns only that trip's slice and says
  it is scoped.
- Without a token it answers `401`, and the guide names that as the "am I signed
  in" check.
- With a capability off, status says it is off rather than omitting it silently,
  and the credits block is absent (not zero) until B89 exists.
- The drafts shape in status and at `/drafts` come from one function, not two.
- `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`, `npm run build`.

## Verified

Built as `lib/api/status.ts` (the assembly) plus
`app/api/v1/[user]/status/route.ts` (twenty lines: authenticate, scope check,
respond). `force-dynamic`, nothing cached.

All four green in the worktree: `npm run build` compiled, `npx tsc --noEmit`
clean, `npx eslint .` 0 errors (4 pre-existing warnings, none in these files),
`npx vitest run` 156 files / 2396 tests. `npm run unused` reports no unused
files, dependencies or unresolved imports.

`test/status.test.ts`, eleven tests, one per acceptance line:

- no token → `401`, which is the guide's "am I signed in" check;
- owner token → journal, both trips, both drafts, features and a `next` in one
  call;
- every draft carries its own `publish` URL, and a published day is not in the
  queue;
- `next` names the drafts and carries "Never publish because it looks
  finished";
- an owner token is told `scope.kind === "journal"`;
- a trip-scoped token gets one trip, one draft, and `scope.note` saying in words
  that it is a slice — the case that matters, since an agent that cannot tell a
  slice from the whole will report "this journal has one trip" to somebody who
  has two;
- `postcards` off is reported as off *with the reason*, not omitted;
- `credits` and `pricing` are absent, not zero;
- no `invites` key where `contacts` is off, because there is no queue to land
  in;
- and the drafts array from `/drafts` is `toEqual` the `drafts.items` from
  `/status` — the "one function, not two" criterion, asserted rather than
  asserted-by-comment.

**The shared shape is `draftQueue` in `lib/api/status.ts`.** The drafts route
lost its own loop and calls it; that is what makes B134's inherited `test` flag
impossible to get wrong in one place and right in the other.

Guide: a new "First, get your bearings" section immediately before
"Authenticating" in `agentGuide()` — two steps, the credential check and then
read-once — and the route is documented in `openapi.json` beside `/drafts`.

Security pass over the branch found nothing introduced. The gate order is
`authenticate` → `ownsUser` → assemble, matching the drafts and trips routes,
and scoping is `writableTrips` rather than a rule reinvented here. The one
question worth recording: the response repeats capability states and their
reasons, which `/api/health` already serves **unauthenticated** by design
(`app/api/health/route.ts:71`) — so this is strictly less exposure than an
existing public endpoint, not new.

Captured along the way: **B288** — status does not carry malformed trips, which
`/trips` does for owners (B83). Not absorbed, because this task's Work section
lists what the response carries and that is not on it.

Left for B89, as this task asked: the `credits` and `pricing` block. It slots in
beside `features` in `journalStatus`; the comment there says so.

### One process slip, recorded because it is the interesting part

The first merge of this branch failed `npx tsc --noEmit` on `main`:
`test/status.test.ts` passed `{ tripId: trip }` to `issueCode`, whose option is
`trip` (`IssueCodeOptions`, `lib/auth/index.ts:273`). It had not been caught in
the worktree because the four checks were run in order — build, tsc, eslint,
vitest — **before** the test file existed, and only vitest was re-run after.
Vitest transpiles without typechecking, so the unknown key was silently
dropped.

Which means the trip-scoped test was passing without the code being bound to
its trip at all — B230's binding was not being exercised, and the assertion
about a slice was true for the wrong reason. Fixed on the branch and re-merged;
the test now goes through the real path.

The lesson is the order, not the typo: the four checks are a gate on the final
tree, and running them before the last file is written is running them on a
different tree.