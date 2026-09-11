---
id: B1495
title: A journal can be synced down to a folder and back up, incrementally
type: FEATURE
priority: medium
complexity: high
area: API, helper, content
found: "2026-09-11T17:22:53Z"
started: "2026-09-11T18:25:09Z"
session: a46b89fa-8d46-44a3-b5fc-84f7c4ed55fb
claimed: "2026-09-11T18:25:09Z"
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
against a folder that is genuinely current rather than a guess.

## Decided, 2026-09-11

Answered by the owner before any code. These are settled; do not re-litigate
them in the branch.

**1. `gps/` is out entirely, and the exclusion is a test.** No sync route ever
reads the position store. A laptop copy gets each trip's derived, clipped
`track.json` and nothing else. Two reasons, neither about this owner: a
manifest covering `gps/` would be the first route in the codebase that can
return a coordinate — served to whoever holds an owner token, and those sit in
agent scrollbacks — and it would end the property that makes the folder safe at
all, that deleting `gps/` leaves every trip rendering identically.
`test/gps-store.test.ts` already asserts the import graph; extend it to cover
whatever module the sync manifest is built from, so this is mechanism rather
than a sentence somebody later disagrees with. A GPS backup, if it is ever
wanted, is a separate feature with its own gate.

**2. Media syncs as derivatives, as the files sit on disk.** The local copy
then renders and validates exactly like the site, and no local derive step can
disagree with the server's and manufacture a false diff on every run. Costs
roughly double bytes on the first sync and only changes after.

**3. Both sides changed the same file → stop, name it, write nothing.** Print
every conflicting path and exit non-zero. `--prefer-local` / `--prefer-remote`
resolve, per file. Silently overwriting a day somebody wrote on the site is the
same class of harm as inventing one.

**4. Deletions propagate, behind a named confirmation.** The base manifest can
distinguish "deleted since the last sync" from "never had it", so a local
delete can remove the day on the site and a remote delete can prune the laptop.
Neither happens silently: the run lists exactly what it is about to delete, on
which side, and waits for a yes. An unattended run (`--yes`) may only be
reached deliberately, and a deletion set above some obvious threshold is worth
refusing outright rather than confirming — decide the number and say so. Note
that deleting a whole journal or trip on the instance still goes through the
delete route and its mail (`lib/deletions.ts`); sync deletes files, never a
journal.

**5. `inbox/` syncs both ways.** It is where photographs wait before they
belong to a day, which is the one job the helper exists for, and its files are
already named by a hash of their own bytes (`lib/inbox.ts`) — exactly what the
manifest wants. The `<name>.meta.json` sidecars go with them. It is not in
`export.zip` today, so the fresh-sync path needs a second call or the export
needs widening — decide which.

**6. Drafts come down.** `status: draft` days sync like any other file, the
way `export.zip`'s `all` scope already does. The folder is a faithful mirror
or it is not a backup.

**7. The client is a new `sync` skill in `fernscout-helper`; `publish` becomes
a thin wrapper over its up leg** and keeps its name, its description and its
docs, so no existing prompt breaks. No CLI in this repository (B671: the door
is the API).

**8. B245 is already done — the blocker this ticket first assumed does not
exist.** `PATCH /api/v1/<user>/trips/<trip>` (`lib/api/tripDetails.ts`) carries
`title`, `tagline`, `start`, `end`, `cover`, `accent`, `costsVisibility` and
`intro`. `visibility`/`listed`, `rates`, `people`, `travellers`, `tracks` and
`costs` have doors of their own. The one field still uncorrectable is
`translations`, which is **B1496**; take it first or absorb it, but do not ship
an up leg that drops it in silence. The `publish` skill's SKILL.md prose about
B245 is stale and should be corrected in the same run.

## Work

Research still open, and it should land as written decisions in this file
before the routes exist:

1. **What identifies a version.** A content hash of the bytes is almost
   certainly the answer — the inbox already names files that way — but decide
   whether the manifest is hash-only or hash + size + mtime, and what the hash
   is (and keep it cheap enough to run over a gigabyte of media on every sync;
   a cached per-file hash keyed on size+mtime is the obvious out).
2. **The doors.** Nothing lists a journal's files with hashes today. Likely
   `GET /api/v1/<user>/sync/manifest` plus a per-file `GET`, `PUT` and
   `DELETE` — owner only, gated with `mayActAsOwner` exactly as `export.zip`
   is, never a trip-scoped token. Check first whether the existing
   per-resource routes can carry the up leg; a new door is only worth it if
   they cannot. A day written through a raw file `PUT` bypasses every
   validator `POST .../days` runs, which is the strongest argument for the up
   leg going through the existing typed routes and only media/inbox bytes
   going through a file door. Decide this one explicitly — it is the biggest
   design question left.
3. **Generated output is out**: `postcards/`, `photobooks/`, `.ingest.json`,
   `track.json` (derived server-side; down-only if it syncs at all).
4. **Fresh sync.** Missing or corrupt local copy → `/<user>/export.zip`, then
   write a fresh base manifest. Confirm the zip is byte-faithful enough to be
   a valid base in its `all` scope, and settle the inbox gap from decision 5.
5. **Base manifest on disk.** `.fernscout-sync.json` in the local root, the way
   `.ingest.json` records what ingest imported. Gitignored, and never uploaded.
6. **Which helper skills this thins.** Read all six in
   `fernscout-helper/.claude/skills/` and say, per skill, whether sync subsumes
   it, feeds it, or is unrelated.

**Not in this ticket:** a daemon or watcher, file locking, multi-machine
concurrency beyond the conflict stop, a public/guest scope (owner only), and
GPS in any form.

Split the build: manifest + file doors here, the `sync` skill in the helper.
Contract work per `keep-the-contract` — every new route in `lib/api/openapi.ts`
with at least one refusal documented.

## Acceptance

- `gps/` is unreachable from the sync path by test, not by comment, and
  deleting `gps/` still leaves every trip rendering identically.
- Against a running instance, as the owner: sync down into an empty folder,
  change one day on the site, sync down again, and only that day's bytes move —
  proved from the run's own printed plan, not asserted.
- Change one day locally, `sync up`, the site shows it, nothing else is re-sent.
- Change the same day on both sides: the sync refuses, names the file, writes
  nothing, exits non-zero.
- Delete a day locally and `sync up`: the run names what it will delete on the
  site and does nothing until confirmed; `--prefer-*` and `--yes` behave as
  documented.
- A photograph added to `inbox/` locally reaches the instance's inbox, and one
  added through the API arrives on the next `sync down`.
- A draft day on the instance is present in the local folder after a sync down.
- A trip-scoped token is refused by every new route, with a test.
- `npm run verify` green; `/openapi.json` documents each new route with a
  refusal.
