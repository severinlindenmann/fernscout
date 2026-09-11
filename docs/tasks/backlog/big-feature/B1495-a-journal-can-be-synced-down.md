---
id: B1495
title: A journal can be synced down to a folder and back up, incrementally
type: FEATURE
priority: medium
complexity: high
area: API, helper, content
found: "2026-09-11T17:22:53Z"
---

# B1495 — A journal can be synced down to a folder and back up, incrementally

## Why

Content flows one way today. `fernscout-helper`'s `publish` skill
(`.claude/skills/publish/publish.mjs`, in the sibling repository at
`/Users/severin/Documents/GitHub/fernscout-helper`) walks a local `content/`
tree, asks the instance what it already has, and sends the difference up. There
is no matching road down. The owner can take `/<user>/export.zip`
(`app/[user]/export.zip/route.ts` → `lib/exportZip.ts`, owner only since
B1086) — the whole journal including media, every time, as a blob. That is a
backup, not a working copy.

So the thing a person actually asks for is not possible: *edit the journal on
my laptop with an agent, publish, edit a day on the site (`EditDay`, the web
helper), then get the newest version back down here and keep working.* Today
the second half means unzipping a full export over the top and losing whatever
was local, or hand-reconciling.

What is wanted is what git gives, for a folder that is mostly photographs:
a local checkout of `content/<user>/`, `sync up` and `sync down` moving only
what changed, and a full re-fetch available when the local copy is missing or
broken. The photographs are why a plain `git` answer is wrong — a journal is
gigabytes of JPEG, the instance already keeps derivatives, and the storage
ceiling (`lib/storageQuota.ts`) counts the whole of `content/<user>/`.

There is a second prize. If a local folder can round-trip faithfully, several
helper skills stop needing to know the API at all — `publish` becomes
`sync up`, and `validate-content`, `trip-budget`, `statement-costs` all work
against a folder that is genuinely current rather than a guess. That
consolidation is the reason to check the helper's skill list as part of this,
not a separate ticket.

## Work

Research first, then build. **The research is the bulk of the value here and
should land as a written decision in this ticket before any code.**

Open questions to answer, in order:

1. **What identifies a file's version.** A content hash of the bytes is the
   obvious answer and the inbox already names files that way
   (`lib/inbox.ts`); mtime alone is not trustworthy across a download. Decide
   whether the manifest is hash-only, or hash + size + mtime.
2. **Where the manifest comes from.** There is no endpoint that lists a
   journal's files with hashes. Almost certainly a new
   `GET /api/v1/<user>/sync/manifest` — owner only, the same
   `mayActAsOwner` gate `export.zip` uses, never a trip-scoped token — plus a
   per-file `GET` for the down leg and a per-file `PUT`/`DELETE` for the up
   leg. Check first whether the existing per-resource routes
   (`…/trips/<trip>/days/<slug>`, `…/trips/<trip>/media`) can carry it; a new
   door is only worth it if they cannot.
3. **What is in scope of a sync and what is deliberately not.**
   - `gps/` is **out**, absolutely. It is in no export and reachable from no
     route by design (AGENTS.md; `test/gps-store.test.ts` asserts the import
     graph). A sync endpoint that served it would be the exact regression that
     test exists to prevent. Say so in the code, not only here.
   - `inbox/` — decide. It is real owner content and it is not in the export.
   - `media/` derivatives: decide whether they sync or are re-derived locally.
     Sending derivatives doubles the bytes; not sending them means a local copy
     that does not render.
   - Generated output (`postcards/`, `photobooks/`) is out.
4. **Conflict.** Both sides changed the same day. The honest model is a stored
   base manifest from the last sync (`.fernscout-sync.json` in the local root,
   the way `.ingest.json` records what ingest imported) and a three-way
   comparison: changed-on-one-side wins, changed-on-both stops and asks. **It
   must stop and ask** — silently overwriting a day somebody wrote on the site
   is the same class of harm as inventing one. Deletion is the sharp edge:
   decide whether a file missing locally means "delete it on the site" (it
   should not, by default) and whether `sync down` may delete local files.
5. **Fresh sync.** Missing or corrupt local copy → fall back to
   `/<user>/export.zip` and write a fresh base manifest. This mostly exists;
   confirm the zip is byte-faithful enough to be a valid base (it filters
   drafts only in the `open-to-link` scope, not `all`).
6. **Which helper skills this replaces or thins.** Read all six in
   `fernscout-helper/.claude/skills/` and say, per skill, whether sync
   subsumes it, feeds it, or is unrelated. `publish` is the obvious one. Note
   that B245 (trip fields with no update door) blocks a faithful up leg for
   `title`, `start`, `end`, `tagline`, `accent`, `intro`, `translations` —
   either B245 lands first or this ticket owns it.

**Not in this ticket:** a daemon, a watcher, file locking, multi-machine
concurrency beyond the conflict stop above, and any CLI in this repository
(B671: the door is the API; the client lives in the helper).

Split the build once the research lands: server-side manifest + file doors
here, the `sync` skill in `fernscout-helper`. Contract work per
`keep-the-contract` — every new route in `lib/api/openapi.ts` with a refusal
documented.

## Acceptance

- The research answers above are written into this file before any route is
  added, and the `gps/` exclusion is a test, not a sentence.
- Against a running instance, as the owner: sync down a journal into an empty
  folder, change one day on the site, sync down again, and only that one day's
  bytes move (prove it from the run's own printed plan, not by assertion).
- Change one day locally, `sync up`, and the site shows it; nothing else is
  re-sent.
- Change the same day on both sides and the sync refuses, names the file, and
  writes nothing.
- A trip-scoped token is refused by every new route.
- `npm run verify` green; `/openapi.json` documents each new route with at
  least one refusal.
