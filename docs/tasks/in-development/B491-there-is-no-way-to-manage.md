---
id: B491
title: A journal folder can be exported and never pushed back, so writing locally is a one-way trip
type: FEATURE
priority: medium
complexity: high
area: content sync, API
found: "2026-09-05T15:47:44Z"
started: "2026-09-12T08:20:18Z"
session: 615a7d13-b735-48b0-a399-bf28e199b7bb
claimed: "2026-09-12T08:20:18Z"
---

# B491 — A journal folder can be exported and never pushed back, so writing locally is a one-way trip

> **Rewritten 2026-09-07.** The capability is still missing, but two of the
> three pieces this ticket proposed have been overtaken and one of them would
> now collide with shipped code. Corrected rather than superseded.

## Why

The content is markdown and photographs in a folder the author owns — that is
the whole pitch — and the round trip only exists in one direction.
`lib/exportZip.ts` builds exactly the layout `lib/trips.ts` and `lib/entries.ts`
read, and `/<user>/export.zip` serves it. Nothing accepts one back. Somebody
who wants to write in Obsidian, iA Writer or a plain editor can take their
journal out and cannot put it in, short of one REST call per day.

## What has changed since this was captured

- **The route name is taken.** This ticket proposed
  `POST /api/v1/<user>/import`, and B671 built a route at exactly that address
  for a different job: it takes a `kind` (`gps`, `costs`) and a stream of rows.
  Whatever this becomes needs its own address — `POST /api/v1/<user>/content`
  is the obvious one, and the distinction is real rather than cosmetic. B671's
  route reads *data about* a journal; this one writes the journal itself.
- **The "downloadable skill" half is somebody else's job now.** The third
  bullet asked for a skill that scaffolds a correct `content/<user>/` locally
  and knows how to pull and push. That is the `fernscout-helper` repository,
  which already has `publish.mjs` and `build.mjs` and a live `content/severin`
  — and whose troubles (B645–B650) are the evidence that the *pushing* half is
  the hard part, not the scaffolding.
- **"The shape, told to whoever is writing locally"** is **B537**, captured
  separately and better: a dry run against the real handlers, plus the
  frontmatter→field mapping served as JSON. Do not build a second answer here.
  B537 is also the cheaper half and should land first — a local writer who can
  ask "would this be refused?" gets most of the value of this ticket without
  the destructive part.

## Revalidated 2026-09-12 — valid, and the Work section rewritten

**The problem is still real.** `lib/exportZip.ts` still builds the tree and
`app/[user]/export.zip/route.ts` still serves it; nothing takes a folder back.
`fernscout-helper` still has `publish` and no `sync` skill, and `publish.mjs`
does no hashing at all — a matched day is re-`PATCH`ed whether or not its bytes
changed, and a photograph is compared by filename alone.

**But the approach in Work was refuted before it was built, by B1495.** That
ticket shipped the server half of sync on 2026-09-11 and carries owner
decisions taken before any code was written, marked *settled; do not
re-litigate*. Two of them delete this ticket's plan outright:

- **There is no file `PUT` and no file `DELETE`, and there will not be a zip-in
  route.** A raw byte door onto a day bypasses `lib/validate/entry.ts` and
  `lib/api/entries.ts` entirely — required fields, `TRANSPORT_MODES`, currency
  codes, the B294 every-locale rule, `EDITABLE_DAY_FIELDS` keeping `status` out
  of a `PATCH`, and `checkWeather`, which refuses a caller supplying its own
  reading. That last one decides it on its own: a zip-in route is a door
  through which an agent writes a temperature nobody measured, by design rather
  than by bug. So `POST /api/v1/<user>/content` is **not** built, and the merge
  semantics this ticket calls its whole risk were answered instead as a
  three-way diff in the client (B1495's table).
- **The up leg goes through the typed routes that already exist.** B1495 walked
  the tree kind by kind and found a door for everything except three
  `config.json` fields (B1504) and a media file belonging to no day (B1503).

**What is actually left is the client**, which B1495 states plainly under
*Still to build* and which has no ticket of its own — so this is it. Its
decisions are all written in B1495 and are not re-opened here.

## Work — rewritten 2026-09-12

In `fernscout-helper`, a new `sync` skill, per B1495's decisions:

- `sync down` — read `GET /api/v1/<user>/sync/manifest`, three-way compare
  against `.fernscout-sync.json` and the local tree, fetch only what differs
  through `GET /api/v1/<user>/sync/file/<path>`, verifying each file's bytes on
  arrival against what the manifest said.
- `sync up` — the same diff, sent through the typed routes `publish` already
  calls. Including B1504: the three `config.json` fields with no door are named
  out loud rather than passed over.
- Both sides changed the same file → print every conflicting path, write
  nothing, exit non-zero. `--prefer-local` / `--prefer-remote` resolve per file.
- Deletions propagate behind a named confirmation, and a run that would delete
  more than half the files on a side is **refused**, not confirmed.
- `publish` becomes a thin wrapper over the up leg, keeping its name, its flags
  and its exact stdout — `publish.test.mjs` asserts on the phrasing.

**In this repository**, one change only: `GET /api/v1/<user>/config` reads back
the journal's own `media` block, so the up leg can tell whether a local edit to
it differs. `owner.email` stays unreadable, deliberately (see B1504).

**Not doing:** a daemon or watcher, file locking, multi-machine concurrency
beyond the conflict stop, a guest scope, and `gps/` in any form.

## Superseded Work — kept for the record

What is left is the inbound route and its merge semantics, which is the whole
of the risk:

- An owner-only route that accepts a zip of a journal folder and applies it.
  **Decide and write down the merge semantics before building** — replace-trip,
  merge-days, and dry-run-diff are the options, and picking one badly is what
  makes this destructive. A dry run is not optional here; it is how somebody
  finds out they were about to lose a trip.
- It must not be able to publish. `status: draft` is the agent contract and an
  import is an agent.
- It must not be able to write outside `content/<user>/`: zip-slip, absolute
  paths, symlinks, `..`, plus the existing `media` size and per-journal byte
  quota (`lib/storageQuota.ts`).
- A trip-scoped token cannot import — this writes across a journal.

Not doing: conflict resolution beyond whatever the chosen merge semantics
demand, and no sync daemon or watcher.

## Acceptance

Export a journal, edit a day's markdown and add a photo in a plain editor, push
the folder back, and the instance shows the edit — with the new day still a
draft. A zip containing `../../etc/x`, an absolute path or a symlink out of the
tree is refused with nothing written. A trip-scoped token is refused. A dry run
of a push that would delete a trip says so before anything is written.

## Open questions

- Replace wholesale, or merge per trip and per day? This is the decision that
  makes the feature safe or dangerous, and it is the reason this is `high`
  complexity rather than a route.
- Zip only, or also a plain multipart push for an agent that cannot build an
  archive? B671 answered the same question with "several doors for the bytes",
  and that answer is probably reusable.
