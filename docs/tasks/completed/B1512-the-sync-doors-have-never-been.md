---
id: B1512
title: The sync doors have never been driven against the live instance or a real journal
type: OPS
priority: high
complexity: medium
area: sync, api, live instance
found: "2026-09-11T19:22:29Z"
merged: "2026-09-14T05:31:45Z"
completed: "2026-09-14T16:31:46Z"
---

# B1512 — The sync doors have never been driven against the live instance or a real journal

## Why

B1495 shipped the server half of journal sync — `GET /api/v1/<user>/sync/manifest`
and `GET /api/v1/<user>/sync/file/<path>` — and B1496 made a trip's
`translations` correctable. Both are merged and in `testing/`. What neither has
had is a real engagement, and three things about how they were verified say why
that matters more than usual here.

**It was proved against a local dev server, never the deployed instance.** The
whole acceptance run was `localhost:3495` on a checkout. `fernscout.ch` differs
in the ways that break file transfer specifically: Caddy in front, a reverse
proxy with its own body and timeout limits, Postgres rather than SQLite, and
real journals whose media is an order of magnitude larger than the 23 MB
example. A manifest call that hashes a gigabyte, or a file `GET` streaming
hundreds of megabytes through a proxy, is exactly the shape that works on a
laptop and times out in production.

**The client was a throwaway.** `scratchpad/sync.mjs` was ~70 lines written to
prove acceptance lines, and it had **two bugs of its own** that made steps look
green while exercising nothing (a refused PATCH, and a conflict rule that
flagged any local edit). Both were caught and the steps rerun — but the lesson
is that the only sync client that has ever touched these routes was written by
the same session that wrote the routes, in the same hour. That is the weakest
possible form of verification, and B1090 is the standing record of why.

**Only one journal was ever synced: `content/example`.** It is demo content,
uniformly shaped, ASCII paths, no inbox, no `originals/`, nothing unusual. The
interesting failures live in what real journals have — a filename with an
emoji or a Cyrillic character, a photograph called `100% done.jpg`, a
`.DS_Store` the Finder left, a video derivative, a trip with an empty `media/`,
a journal mid-upload while the manifest is being built.

The priority is high because this is a **read door onto the owner's entire
journal**, drafts and private trips included, and because the security pass on
the branch found three real defects in code that had already passed a green
`npm run verify` — including exclusions that compared case-sensitively on a
case-insensitive filesystem. A green suite has already been shown not to be
enough for this particular feature.

## Work

An OPS engagement: drive the live instance, file what breaks. The deliverable
is findings and other tickets, not a diff.

1. **Against `fernscout.ch`, as a real owner.** Manifest a journal that is not
   `example`. Time it. Fetch the largest file it lists. Watch for proxy
   timeouts, truncated bodies, and whether `Content-Length` is honoured all
   the way through Caddy.
2. **A real sync down of a real journal**, into an empty folder, verifying
   every file's hash on arrival. Then change one day through the site and
   confirm the second run moves only that day.
3. **Awkward filenames.** Build a `test-<something>` journal deliberately
   holding: non-ASCII names, a name with `%` in it, a name with a space, a
   very long name, and a `.DS_Store`. Confirm each is either listed and
   fetchable, or excluded — never listed-but-unfetchable, which would stall a
   client mid-run with no way forward.
4. **The refusals, live.** A trip-scoped token, another journal's token, no
   token, `gps/`, `originals/`, `track.json`, and a path climbing out. All
   404 or 401 on the deployed instance, not only in vitest.
5. **B1496 in the same session**, since it is one API sitting: correct a
   `translations` block on a real trip and read it back, and confirm an
   undeclared locale is refused in the same words create refuses it in.
6. **Concurrency**, briefly: a manifest built while an upload is in flight
   should not fail — a file vanishing between the walk and the `stat` is
   handled, but that path has never actually been hit.

**Not in this ticket:** building the `sync` skill in `fernscout-helper`. That
is the client half and is its own work; this is about whether the doors hold.
If a proper client exists by the time somebody picks this up, use it instead of
a throwaway — but do not block on it.

## Acceptance

- A real journal on `fernscout.ch` synced down to a folder, with every file's
  hash verified, and the wall-clock time for the manifest and the transfer
  recorded in this file.
- A second run after one change moves exactly that change, proved from the
  run's own plan.
- Every refusal in item 4 confirmed against the deployed instance.
- The awkward-filename journal either round-trips or is excluded, with no
  listed-but-unfetchable path.
- Whatever breaks is a new `backlog/` capture referenced by id from here. If
  nothing breaks, that is the finding and it is written here in as many words.

## Findings (2026-09-14, run against fernscout.ch)

**The instance had been wiped to a clean slate that morning, restored from
this repository — `example` was the only real journal on it.** So "a real
journal that is not `example`" did not exist to synced; `example` (23 MB, 155
files) is what item 1 and 2 were driven against, plus two throwaway
`test-b1512-*` journals for the awkward-filename and refusal work (both
deleted from disk by hand at the end of the session — never through
`DELETE`, which mails rather than deletes). Credentials came from
`.claude/skills/get-a-credential/`, which worked as written; no correction
needed this time.

**Could a journal be reconstructed from these two doors alone? No — two
gaps, one a real defect (filed as B1692) and one a documented, deliberate
exclusion.** `content/<user>/figures/` — a traveller's own likeness,
owner-writable via `PUT /api/v2/<user>/figures/{id}` and referenced by trips
and days — never appears in the manifest at all, and is never named as
omitted the way `originals` is. `example`'s manifest listed the 155 files
under `trips/**` and `config.json`; its 12 `figures/*.json` files were
silently absent. Filed as **B1692**. `originals/` is the other gap and is
**not** a defect — it is a documented design choice, reported honestly (see
below).

**1. Manifest and file fetch, timed.** `GET .../sync/manifest` for `example`:
200, 0.39s wall clock, 17.9 KB response describing 155 files / 23,597,150
bytes. The largest file it lists (`trips/asia-2023/media/mekong-slow-boat/
04.jpg`, 598,052 bytes) fetched in 0.52s with `Content-Length: 598052`
matching the byte count exactly, through Caddy (`via: 1.1 Caddy` on the
response). No truncation, no timeout — but the example journal's largest
file is ~600 KB, nowhere near the "gigabyte journal" or "hundreds of
megabytes through a proxy" scenario the ticket is actually worried about.
**That case is unverified** — there was no larger real journal on the wiped
instance to test it against.

**2. Full sync-down, hash-verified.** All 155 files of `example` fetched
one-by-one (53s wall clock, sequential, one request per file — no
concurrency in the client) into an empty local folder. Every file's SHA-256
matches the manifest's hash and the repository's own copy of
`content/example`, byte for byte: 0 mismatches across all 155 files. A
second manifest fetched immediately after was byte-identical to the first
(nothing had changed, as expected).

**Second-run-moves-only-the-change, proved on a test journal (not
`example`, per the write rule).** Created `test-b1512-sync` via the API,
wrote one trip and one draft day (`test: true` throughout). Manifest
baseline: 3 files. `PATCH .../days/2026-01-01-first-day` to correct the
day's content. Re-fetched the manifest: exactly
`trips/sync-check/entries/2026-01-01-first-day.json` changed hash; the
other two files (`config.json`, `trips/sync-check/trip.json`) were
byte-identical to the baseline. This is the plan a real sync client would
compute and act on.

**3. Awkward filenames, live.** Placed on disk directly (not through the
upload API, which validates image bytes): a filename with `%` (`100%
done.jpg`), one with a space, one with accented Latin (`café façade.jpg`),
one with Cyrillic (`фото.jpg`), a 204-character name, and a `.DS_Store`.
Result: the five real files were all listed in the manifest **and** all
five fetched with the exact byte count the manifest promised, through
percent-encoding the path segments myself (Next has already decoded them
server-side, per the route's own comment). `.DS_Store` was correctly
absent from the manifest and separately confirmed 404 on direct fetch — no
listed-but-unfetchable case, in either direction.

**4. Refusals, live — genuinely indistinguishable, not just coincidentally
the same code.** The first pass using only the admin token
(`agent@fernscout.ch`, which is owner of *every* journal by design) gave a
false green: an "unknown journal" and "another journal's token" both
answered `200`, because the admin bypass in `ownsUser`/`isOwner` doesn't
care whether the target journal exists or is really "another" one to that
identity. Redid it properly with a **second, non-admin owner token**
(a throwaway `test-b1512-owner2` journal with its own distinct owner
email, its own mailed code, redeemed for a real journal-scoped token) and
a **trip-scoped token** for `test-b1512-sync`'s one trip:

  - Own journal, correct token → `200` (control).
  - That non-admin token against `example`, and against
    `test-b1512-sync` → `404 not_found`, both times.
  - That token against a journal name that does not exist → `404
    not_found`.
  - No `Authorization` header at all, against a real journal and a
    nonexistent one → `404 not_found`, both times.
  - The trip-scoped token (verified live and able to write its own trip's
    day) against its own journal's `sync/manifest` and `sync/file` →
    `404 not_found` — refused even though the token is real and the
    journal is its own.
  - `gps/`, `trips/<id>/track.json`, `trips/<id>/media/originals/<file>`,
    and three shapes of path-climbing (`../`, `%2e%2e/`, encoded) → all
    `404 not_found`.

  Every case above answers with the identical body
  `{"error":"not_found","message":"Nothing at this address."}` — a probe
  cannot tell "wrong token", "wrong journal", "trip-scoped token",
  "excluded path" or "no such journal" apart from outside, which is exactly
  the property this door exists to have.

  **Caveat:** the `gps/`, `track.json` and `originals/` checks were run
  against paths that do not currently exist on the wiped `example`
  journal (a fresh restore has none of these — GPS history and derived
  tracks are runtime state, not checked-in content, and `example` carries
  no `originals/`). A `404` for a path that is both nonexistent *and*
  excluded does not distinguish "refused by policy" from "refused because
  there's nothing there." `inSync()` was read to confirm the policy
  refusal is real (case-folded root check, `EXCLUDED_ROOTS`, `originals`
  segment check, `realpath`-based symlink/traversal guard) but the
  live door's behaviour against an *existing* file in one of those
  categories was not directly observed this session.

**5. B1496 translations, live.** `PATCH .../trips/sync-check` with
`translations: {"de": {...}}` on a journal whose `locales` was `["en"]`
only → refused with `invalid_translations`, naming the field and the
declared locale set in the message. Declared `de` on the journal (`PATCH
/api/v2/<user>` with `locales: ["en","de"]`), then `PUT`-creating a
*second* trip with the same undeclared-locale translation reproduced the
**identical** refusal body — same error code, same message, same
`details` shape — confirming create and correct refuse in the same words.
Then corrected the trip's `de` translation for real and read it back via
`GET`: round-tripped exactly.

**6. Concurrency — a smoke test, not a forced race.** Fired 5 concurrent
media-upload attempts against `test-b1512-sync` alongside 8 concurrent
`sync/manifest` fetches. All 8 manifest calls answered `200` with no
errors or 500s; the uploads themselves failed on image validation (the
test file wasn't a real JPEG), so this did not exercise a file actually
appearing or vanishing mid-walk. **The exact "file vanishes between
`readdir` and `stat`" window could not be forced deterministically from
outside** — it's a microsecond race, and the ticket's own wording ("that
path has never actually been hit") suggests this needs a fault-injection
test rather than black-box timing. Code inspection confirms the `try/catch`
around `fs.statSync` in `buildManifest` and `countOriginals` both treat a
vanished file as "count it as nothing" rather than failing the whole
manifest, which is the right behaviour if the race is ever hit.

**What could not be checked, and why:**
- A journal with real-world scale (a gigabyte, hundreds of files of several
  MB each) — none existed on the wiped instance. The proxy-timeout and
  truncation risk the ticket opens with is exactly the thing this run could
  not exercise.
- The genuine `readdir`-vs-`stat` race (see item 6).
- `gps/`/`track.json`/`originals/` refusal against a path that actually
  exists (see item 4's caveat) — the wiped instance had none of these to
  test against, and this session did not fabricate GPS history to avoid
  writing to the one folder this project is emphatic about never touching.
- Whether Postgres (vs. the SQLite the routes were originally proved
  against) behaves any differently — the sync doors read the filesystem
  directly and touch no query the session could see fail, so nothing
  suggested a difference, but it was not specifically isolated.

**Filed:** B1692 — the sync manifest never lists `content/<user>/figures/`.
