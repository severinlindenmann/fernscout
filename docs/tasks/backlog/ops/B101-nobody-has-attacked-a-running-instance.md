---
id: B101
title: Nobody has attacked a running instance from the outside with the source in hand
type: OPS
priority: high
complexity: high
area: security, api, auth
found: "2026-09-03"
---

# B101 — Nobody has attacked a running instance from the outside with the source in hand

## Why

> **Stale reference, 2026-09-04.** B298 removed MCP: there is no `lib/mcp/`
> and no `/api/mcp`. Every mention of an MCP tool or endpoint below describes
> deleted code, and "the network door" now means the REST API alone. The
> reasoning is unchanged — the paths it names are one fewer than it says.

Every security fix in this backlog so far — B01 (X-Forwarded-For), B36 (address
matching), B55 (single-use signup token) — was found by reading the code. None
was found by attacking a running instance. The two find different things: a
review finds the bug in the function it is looking at; an attacker finds the
request the whole system did not expect, the two correct components that are
wrong together, the header the proxy passes through that the app trusts.

Fernscout is open source, so a real attacker has the source too. That is the
threat model to test under, and it is an advantage worth using: a
**grey-box penetration test** — attacking the live HTTP surface from outside,
with the codebase open beside it to aim at the parts that actually gate access
rather than fuzzing blind. The goal is a written findings report, and one
backlog task per confirmed finding (SECURITY, priority set by real impact),
each with a reproduction. This task is the engagement; its output is other
tasks and a report, not a code change.

The surface is large and every piece of it is reachable without a browser
(decision 24 — the API is the product):

- **Auth and tokens.** `POST /api/auth/request` + `/verify`, the signup flow
  (`/api/auth/signup/*`), agent tokens vs guest cookies and the wall between
  them (`resolveSession`, `lib/auth`). Can a trip-scoped token touch another
  trip? Can a guest cookie be presented as a bearer token or vice versa? Do the
  202-for-everything endpoints leak who is registered through timing or error
  shape? Is the six-digit code's five-guess burn actually enforced across
  concurrent requests?
- **Authorization boundaries.** `ownsUser`, `writableTrips`, `mayReadTrip`,
  the visibility gates (`lib/tripGate.ts`, `lib/digest/visibility.ts`). A
  private trip, a guest trip, a draft (`status: draft`), a `test: true` day —
  can any of them be reached by someone who should not, through the REST API,
  the MCP endpoint, the `.md` twin (`/day/<slug>.md`), the search index, the
  feed, the sitemap, or the RSC payload? B44/B68/B70 show this class is live.
- **The username as a security boundary.** It is a directory name
  (`lib/trips.ts`, `parseTripRef`). Path traversal, reserved-name and tombstone
  handling (`lib/tombstones.ts`, the `410` path), the depersonalisation
  boundary — can a crafted `<user>` or `<trip>` or `<slug>` escape
  `content/<user>/`?
- **The confirmation and deletion flows.** `lib/agentConfirm.ts` (not
  single-use, goes to the agent — is it ever used where single-use was
  required?), the mail-gated deletion (`lib/deletions.ts`) — can the
  mail-in-a-mailbox second step be bypassed, replayed, or satisfied by the
  agent? Can a confirmation code minted for one day verify against another?
- **Media and fetch.** URL upload / `fetchMedia` (`lib/api/fetchMedia.ts`) —
  SSRF, DNS rebinding (B03 is open on exactly this), the per-day and per-journal
  media quotas, decompression and dimension bombs.
- **Rate limiting and abuse.** `lib/rateLimit.ts` and `clientIp` (B01, B04) —
  is every limit keyed on something the client cannot forge now? Signup and
  journal-creation caps (B92 lowers these) — can they be exceeded through
  concurrency?
- **Injection and rendering.** Markdown → HTML, the CSP (B02), stored content
  rendered in mail templates, in postcards, in the PDF pipeline. Frontmatter
  that lies (an unrecognised `visibility`, a `people:` block naming someone
  else).
- **MCP.** `/api/mcp`, `lib/mcp/` — the same operations as REST; test that the
  same boundaries hold there, and the idempotency layer
  (`lib/mcp/idempotency.ts`) cannot be tricked into replaying or skipping a
  write.

## Work

This is an engagement, run by a session dedicated to it — the user's plan is an
Opus session driving it, with subagents where fan-out helps. It is *not* a
code-change task; keep the two apart so a fix and its discovery are separate
records.

- **Target a local instance**, booted with capabilities both on and off, with
  seeded content — never a production journal, never anyone's real data. All
  testing is against an instance the operator controls; this is authorized
  testing of our own software.
- **Work the list above** methodically, source open, aiming at the gate rather
  than fuzzing blind. For each candidate, get a concrete reproduction — the
  exact request and the wrong response — before it counts as a finding. An
  unverified hunch is a note, not a finding (the codebase's own standard: a
  finding is reproducible).
- **Write the report** to `docs/security/` (create it): scope, method, what was
  tested and found sound, and each confirmed finding with its reproduction and
  impact.
- **Open one backlog task per confirmed finding**, SECURITY, priority by real
  impact, referencing this task and the report. Do not fix anything here —
  fixing is a separate task through `open/` like any other, so each fix gets its
  own review.
- **Check against what is already filed** before opening a task — B01–B04, B36,
  B55, B68, B70 and others cover known issues; a rediscovery references the
  existing id rather than opening a duplicate.

Explicitly out of scope: attacking infrastructure that is not ours (a real
provider's API, the VPS host), denial-of-service against shared services, and
anything against a live instance holding real journals. The point is our
application's logic, tested safely.

## Acceptance

- A report in `docs/security/` covering the surface above: method, what held,
  what did not.
- Every confirmed finding has a reproduction someone else can run, and its own
  SECURITY task in `backlog/` referencing this one — or a note that the surface
  was tested and nothing was found, which is also a result.
- No production or personal data was touched; all testing was against a local
  instance.
- Rediscoveries of already-filed issues reference the existing id instead of
  duplicating it.
