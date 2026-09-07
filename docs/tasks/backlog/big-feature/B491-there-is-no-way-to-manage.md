---
id: B491
title: A journal folder can be exported and never pushed back, so writing locally is a one-way trip
type: FEATURE
priority: medium
complexity: high
area: content sync, API
found: "2026-09-05T15:47:44Z"
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

## Work

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
