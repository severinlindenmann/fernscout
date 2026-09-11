---
id: B1512
title: The sync doors have never been driven against the live instance or a real journal
type: OPS
priority: high
complexity: medium
area: sync, api, live instance
found: "2026-09-11T19:22:29Z"
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
