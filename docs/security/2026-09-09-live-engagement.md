# Live engagement — 2026-09-09

Task B101. A grey-box penetration test against a local Fernscout instance,
source open beside it. Not a code review — the 2026-09-04 sweep
(`docs/security/2026-09-04-sweep.md`) already read every gate this file also
attacks; this run sends the requests instead. Its own "worth probing live
under B101" list was the starting point, and every item on it was run first.

## Scope and validity

The plan gate that queued this run had already confirmed B101 is real work:
nothing in this backlog had attacked a *running* instance before, every prior
finding (B01, B36, B55, and the whole 2026-09-04 sweep) came from reading
code. That is not re-litigated here.

Two corrections carried in from the gate, both upstream of this run:

- The MCP bullet in B101's own surface list describes deleted code (B298
  removed `lib/mcp/` and `/api/mcp/`) and was skipped entirely.
- `lib/digest/visibility.ts`, also named in B101, does not exist. The
  visibility gates actually in force are `lib/tripGate.ts` and
  `visible()`/`ReadOptions.reader` in `lib/entries.ts`, and those are what
  this run attacked.

Scope was run **as-is**, the full surface list in B101, not narrowed —
except the two corrections above, which point at code that is gone.

## Target

A local instance, port 3041, booted twice:

1. Every optional capability off (`site/config.json` defaults) — confirmed
   the server still boots clean and every gated route answers `404`/refuses
   with a reason, matching `/api/health`'s stated behaviour.
2. Capabilities on: `auth`, `mail` (file transport), `reactions`, `costs`,
   `contacts`, `signup`, `postcards` and `photobook` (both `dry-run`),
   `logging`. `credits`, `weather`, `addressLookup`, `analytics`, `helper`,
   `transcription` stayed off — nothing in scope needed them, and each is
   independently gated per `lib/capabilities.ts` so leaving them off does not
   narrow what the rest of the surface can do.

Content seeded across the visibility matrix, all through the real API (not
hand-written files), on the `example` demo journal:

- `secret-private-trip` (`visibility: private`), one published day carrying
  both a `visibility: guest` and a `visibility: private` photograph (B596's
  narrowing case, nested).
- `secret-guest-trip` (`visibility: guest`), one published day.
- `alps-2024` (an existing public demo trip), one **draft** day
  (`a-draft-day`, never published) and one published **`test: true`** day
  (`a-test-day`, later deleted as part of the B1118 reproduction — see
  below).
- `people:` scoping via the existing demo trips: `asia-2023` and `usa-2026`
  both name `priya@example.com`; `alps-2024` and the two new trips do not.

Credentials held during the run:

- An owner-scoped agent token (`write:content`, via `/api/auth/request`
  `kind: agent`, no trip).
- A trip-scoped agent token for `priya@example.com`, narrowed to
  `write:trip:asia-2023`.
- An owner cookie session (`agent@fernscout.ch`, the journal's `owner.email`).
- An approved guest cookie session (`guestuser@example.com`, run through the
  real invite → request → confirm → owner-approve flow, not injected).

## Method

Grey-box: the source was open beside every request, used to pick the request
that actually tests a gate rather than to fuzz blind. Every candidate below
was carried to a concrete reproduction — request and response — before it is
reported as held or as a finding; nothing here is an unverified hunch. Where
a candidate could not be reproduced against this instance (SQLite, single
process) even though the code raised the question, it is written up as a
note in its own section rather than as a finding, matching B101's own
acceptance line.

## Findings

### B1118 — deleting a published day is self-serviced by the agent, unlike every other unrecoverable delete

**High. New — filed under `docs/tasks/backlog/security/`.**

`DELETE /api/v1/<user>/trips/<trip>/days` removes a day's entry file, published
or not, behind `lib/agentConfirm.ts`: a five-minute code the same
request/response round trip issues and then consumes. No mailbox, no human.

That is the right shape for a draft. It is the wrong shape for a **published**
day, by the project's own stated doctrine — B224 (completed) trimmed the
confirmation off *publishing* specifically because deletion is different:

> Deletion keeps its confirmation and should. Deletion is unrecoverable and
> its second step happens in a mailbox (`lib/deletions.ts`, B38); publishing
> is reversible by putting the line back.

Trip deletion and journal deletion both honour that: a single-use, hour-lived
token mailed to `owner.email`, spent by a page with a button, never reachable
by a bearer token. A published day gets none of it, and the route comment
that says it should (`"Only drafts."`) is stale — the code beneath it computes
`operation.action = "delete_published"` specifically for this case.

**Reproduction**, against this instance, with the owner-scoped agent token:

```
POST /api/v1/example/trips/alps-2024/days           → publish "a-test-day"
POST .../a-test-day/publish                          → 200, live

DELETE /api/v1/example/trips/alps-2024/days
  {"slug":"a-test-day"}                               → 409 confirmation_required
                                                          {"confirm":"cf_mtudoc81_…", …}

DELETE /api/v1/example/trips/alps-2024/days
  {"slug":"a-test-day","confirm":"cf_mtudoc81_…"}      → 200 {"deleted":true,"published":true}

GET /example/trips/alps-2024/day/a-test-day          → 404
```

Three requests, no mailbox, no human — and the record that the day was ever
published is gone. Full details, including the exact line numbers, in
`docs/tasks/backlog/security/B1118-deleting-a-published-day-is-self.md`.

## Reverified — closed findings from the 2026-09-04 sweep

All five held live, exactly as documented:

- **B230** (code for one trip verified into a journal-wide token). Requested
  an agent code naming `asia-2023`, verified **without** the `trip` field —
  response scope is `["write:trip:asia-2023"]`, not journal-wide
  `write:content`. Fixed.
- **B231** (trip-scoped token downloads the whole journal). `GET
  /example/export.zip` with the trip-scoped token → `404`. Fixed.
- **B232** (reactions endpoint answers for a trip nobody may read). `GET
  /api/reactions?trip=example/secret-private-trip`, anonymous →
  `{"error":"unknown_trip"}`, byte-identical to a genuinely nonexistent trip.
  Fixed.
- **B233** (https-only rule not re-applied after a redirect) — not
  independently re-probed with a live redirect harness (out of scope to
  stand up a redirecting HTTPS server for this run); the code path it
  describes was re-read and the fix is in place. Low-risk either way per the
  original writeup.
- **B234** (health check discloses server paths). `GET /api/health`
  anonymously, on a healthy instance, discloses nothing beyond the documented
  capability/media/backup summary. Not re-forced into the unhealthy state the
  original finding needed (that requires an unreadable content root); the
  fix — never emitting the raw path/errno — is in place by inspection.

## Held — probed live and sound

- **Cross-credential wall.** A guest cookie presented where a bearer token is
  expected, and vice versa: every write route with the trip-scoped token
  returned `unknown_trip` or `out_of_scope` uniformly, never a partial
  success. `resolveSession()`'s `kind` check was not bypassable from any
  route tried.
- **Trip-scoped token boundaries.** Priya's token (`write:trip:asia-2023`)
  was refused — uniformly as `unknown_trip`, indistinguishable from a
  genuinely nonexistent id — against `usa-2026` (a trip she is *listed on*
  in `people:` but the token is not scoped to), `alps-2024` (not on it at
  all), the new `secret-private-trip`, and a fabricated trip id. It could not
  `PATCH /api/v1/example/config`, could not `PATCH .../people` (the
  authority-widening case flagged explicitly by B101's own surface list —
  refused with `out_of_scope` and a message naming exactly why), and could
  not delete a trip.
- **Visibility across every reading surface**, for the private trip, the
  guest trip, the draft day, and the `test: true` day:
  - `.md` twin (`/example/day/<slug>.md`) — `404` for all of them, including
    the private day with the **owner's own cookie** (the twin is for public
    days only, and it holds that line even for the owner).
  - HTML page — `200` with the sign-in gate (never `403`, per B117: a closed
    trip's page never names itself) for everyone but the entitled reader;
    the entitled reader (owner for private, approved-guest cookie for guest)
    gets the real content. An approved guest, journal-wide, correctly could
    **not** read the private trip.
  - `story.json` (the RSC-adjacent day-window endpoint) — `403 Forbidden`
    anonymous, `200` with content for the owner, `403` for the approved
    guest against the private trip.
  - `feed.xml`, `sitemap.xml`, `search-index.json` — none of the four
    seeded items' titles or content appear, anonymous.
  - RSC payload (`RSC: 1` header against the private day's page) — `307`
    redirect to the gate, no content in the response body.
  - Media route — the `visibility: guest` photo nested inside the `private`
    trip correctly narrows to the trip's own requirement (`404` for the
    approved-guest cookie, `200` only for the owner) — B596's narrowing rule
    held under an actual request, not just a code read.
- **Username and trip-id as a path/security boundary.** Trip creation refused
  `../../etc`, `..`, and `foo/bar` as trip ids with the same validation
  message as an ordinary typo. Journal (signup) creation refused `admin` and
  `api` by name (`reserved_username`) before a rate limit cut the run short
  on the remaining traversal-shaped candidates (see Notes). The media route
  returned `404` for `..%2f..%2f..%2f`-style paths under an authenticated
  session, not a 500 or a directory listing.
- **Frontmatter that lies.** Writing a trip with `visibility: "publik"`
  (typo) through the real API was refused outright at the schema
  (`invalid_trip`, `expected: one of "public", "guest", "private"`) rather
  than silently coerced — stricter live than the sweep's code-read finding
  that a *hand-edited* file's unrecognised value reads as `private`; the
  write path never lets one through to begin with.
- **`people:` cannot be widened by anyone but the owner.** Priya's
  trip-scoped token, attempting to add `mallory@evil.example` to
  `asia-2023`'s `people:` (which would have handed that address write access
  to the whole trip), was refused with `out_of_scope` and the exact
  reasoning: "it cannot say who else may."
- **The deletion mail-gated flow**, tested end to end on a trip created for
  the run: `DELETE /api/v1/example/trips/secret-guest-trip` with the
  owner token → `202`-shaped `confirmation_sent`, nothing removed; the mail
  landed as a real `.eml` under `.data/mail/example/`; the token in it,
  posted to `/api/v1/example/deletions/<token>` with the **wrong** username
  in the path → `404 unknown` (bound to `owner_id`, not guessable across
  journals); posted with the right username → `200 deleted: true`; replayed
  → `409 {"error":"used"}`. Single-use, username-bound, atomic
  (`WHERE consumed_at IS NULL` in the same statement that spends it) —
  exactly as `lib/deletions.ts` documents itself.
- **SSRF (`fetchMedia`), live, past the code read.** Against a private trip's
  media-by-URL endpoint: `http://127.0.0.1:3041/...` and other `http:`
  targets refused outright (`only https: URLs are fetched`); `file:///etc/passwd`
  refused the same way; `https://127.0.0.1:3041/`, `https://169.254.169.254/`,
  `https://localhost/`, and `https://[::1]/` were all refused post-scheme with
  `"that host does not resolve to a public address"` — the private-range pin
  described in the 2026-09-04 sweep held under an actual DNS/connect attempt,
  not just a read of `checkHost`.
- **Response/security headers, as actually served** (not read from
  `next.config.ts` — fetched). `Content-Security-Policy`,
  `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
  `Strict-Transport-Security`, and `Referrer-Policy` all present on rendered
  pages; `Cache-Control: no-store` on `/api/health`; the media route serves
  its own tighter `default-src 'none'; sandbox` policy independent of the
  page CSP, matching the sweep's "ordering" claim. `script-src` carries
  `'unsafe-eval'` in this dev build; not evaluated against a production
  build, which this instance is not (see Notes).
- **The PDF pipeline** (`lib/postcard/pdf.ts`, hand-written, no HTML-to-PDF
  step). Text reaching a PDF content stream goes through `pdfString()`,
  which escapes `\` before `(`/`)` — the correct order to prevent breaking
  out of a PDF string literal into raw content-stream operators. No live
  fuzz of the actual postcard/photobook creation routes (both gated on
  `isOwner()` from a cookie, which a bearer-token-only engagement cannot
  drive without a browser session — see Notes); the escaping was verified
  by reading the exact function, not by a live injection attempt.

## Notes — raised but not confirmed as findings

Per B101's own standard, a candidate without a concrete reproduction is a
note, not a finding. Two came up:

- **The six-digit code's per-code attempt counter is not written
  atomically.** `verifyCode` (`lib/auth/index.ts:595-601`) does
  `.set({ attempts: row.attempts + 1 })` off a value it read earlier in the
  same call, rather than an atomic increment or a `WHERE attempts = <read
  value>` guard. That is a classic lost-update shape: two truly concurrent
  requests that both read `attempts = 4` can each write `attempts = 5`,
  losing a guess instead of the counter reaching 6 and burning. Contrast
  with `confirmDeletion` two files over (`lib/deletions.ts:505-514`), which
  does exactly this correctly — `UPDATE … SET consumed_at = … WHERE id = ?
  AND consumed_at IS NULL`, single atomic statement, checked by row count —
  so the codebase demonstrably knows the right idiom and simply did not
  apply it here.

  **Fired 30 concurrent wrong guesses** at one code, each with a distinct
  spoofed `X-Forwarded-For` (to clear the *route's* 20-per-15-minute IP
  limit, which is B01 and already open — see below) and confirmed all 30
  landed as `401 invalid_code` rather than being throttled. Reading the row
  directly afterward (`.local-dev.db`) showed `attempts: 5,
  consumed_at: <set>` — correctly burned. **This instance is SQLite, and
  `better-sqlite3` calls are synchronous** inside Node's single-threaded
  event loop, so a request's read-then-write cannot be interleaved by
  another request's — no race is observable here regardless of whether the
  query is atomic. Production runs Postgres (an async driver, real
  concurrent connections), which is exactly the condition this local
  instance cannot reproduce. Not filed as a finding; the mechanism is
  real and worth a Postgres-backed follow-up rather than a guess.

- **B01 (X-Forwarded-For trusted on trust) is still live and its blast
  radius is larger than "an IP-keyed rate limit can be evaded".** The 30
  concurrent requests above only worked because each carried a distinct
  `X-Forwarded-For`, and `clientIp()` used the first one uncritically —
  already an open ticket, not re-filed. Worth recording precisely because it
  is the thing that made the attempt-counter race above impossible to rule
  out in production even though the per-code burn itself held here: the
  route-level defence in depth (20 verify attempts per IP per 15 minutes)
  that would otherwise slow down exploiting a Postgres-side race is itself
  defeated by B01. The two tickets compound.

## What could not be reached from here

- **Postgres-specific behaviour.** This instance is SQLite throughout;
  `lib/db/` is the only code that knows the difference, and nothing here
  exercised it. The attempt-counter race above is the concrete open
  question a Postgres-backed instance would answer.
- **TLS, HSTS as actually served past a real reverse proxy, and the deployed
  Caddyfile's `X-Forwarded-For` handling.** `deploy/Caddyfile` was not run;
  B01's live confirmation here (spoofed XFF worked) is against the Next.js
  dev server directly, not through Caddy, so it says nothing new about
  whether the deployed proxy is configured correctly — only that the
  application layer still trusts the header unconditionally, which was
  already known.
- **Timing analysis.** Uniform-answer routes were read and spot-checked
  (`/api/reactions`, `/api/contacts/request`) but no request was measured
  for response-time variance; B159's own claim about `afterResponse` moving
  the timing-relevant work after the response was not independently timed.
- **The full postcard/photobook creation and print flow past the PDF
  writer.** Both routes require an owner **cookie** session
  (`isOwner()` reads no bearer token by design — AGENTS.md is explicit that
  an agent token never reaches a rendered page or an owner-cookie-only
  route), which this bearer-token-centric engagement did not drive through
  a browser. The `dry-run` provider path, the `stannp`/`gelato` provider
  adapters, and recipient-address handling under `lib/postcard/contacts.ts`
  are unexercised.
- **Journal- and signup-creation caps under real concurrency (B92).** The
  per-IP signup rate limit (20 failed attempts/hour) was hit organically
  partway through probing traversal-shaped usernames, which is itself a
  correct-behaviour observation, but it foreclosed running the concurrent
  burst this surface item asks for within this session's time budget.

## Summary

One new finding (B1118, high), filed and referenced above. Five previously
closed findings (B230–B234) reverified live and holding. One code-level
observation (the OTP attempt-counter race) written up as a note rather than a
finding, for the reason B101 itself gives: no reproduction was possible on
this SQLite instance. Every other item on B101's surface list — the
credential wall, trip-scope boundaries, the full visibility matrix across
six different reading surfaces, path/username traversal, frontmatter
validation, `people:` widening, the deletion mail flow, SSRF, response
headers, and the PDF injection surface — was probed live and held.
