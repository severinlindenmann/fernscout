---
id: B491
title: There is no way to manage a journal's content folder locally and sync it to a running instance
type: FEATURE
priority: medium
complexity: high
area: content sync, API, skills
found: "2026-09-05T15:47:44Z"
---

# B491 — There is no way to manage a journal's content folder locally and sync it to a running instance

## Why

The content is markdown and photographs in a folder the author owns — that is
the whole pitch — but today the only way to *get* that folder is to have a
checkout of this repository, and the only way to get edits back onto a running
instance is one REST call per day. Somebody who wants to write in Obsidian, iA
Writer, a plain editor, or with an agent that has no network access to the
instance has no round trip: write locally → push the whole folder → keep
writing locally → push again.

Half of it already exists in one direction. `lib/exportZip.ts` builds exactly
the layout `lib/trips.ts` and `lib/entries.ts` read ("unzip into
`content/<username>/`, nothing bespoke") and `/<user>/export.zip` serves it.
There is no inbound counterpart, and no skill that says what a valid folder
looks like to somebody who does not have this repo.

## Work

- **In** — an owner-only route that accepts a zip of a journal folder and
  applies it: `POST /api/v1/<user>/import`. Decide and write down the merge
  semantics before building; the obvious options are replace-trip, merge-days,
  and dry-run-diff, and picking one badly is what makes this destructive.
  Whatever it does, it must not be able to publish (`status: draft` is the
  agent contract, and an import is an agent) and it must not be able to write
  outside `content/<user>/` — zip-slip, absolute paths, symlinks, `..`, plus
  the existing `media` size/quota limits.
- **The shape, told to whoever is writing locally** — a machine-readable
  description of the folder: frontmatter fields, required vs optional, the
  visibility vocabulary. Serve it from the running instance (next to
  `/agent.md`) so a local agent can fetch the contract from the instance it
  will push to, rather than from a doc that drifts.
- **A downloadable skill** that scaffolds a correct `content/<user>/` locally —
  `config.json`, a trip, a day — and knows how to pull and push. It is the
  same content behind a third door, so it belongs beside `add-a-trip` and
  `add-a-day` rather than duplicating their field lists.
- Not doing: conflict resolution beyond "last push wins" unless the merge
  semantics chosen above demand it, and no sync daemon or watcher.

## Acceptance

Export a journal, edit a day's markdown and add a photo in a plain editor,
push the zip back, and the instance shows the edit — with the new day still a
draft. A zip containing `../../etc/x`, an absolute path, or a symlink out of
the tree is refused with nothing written. A trip-scoped token cannot import.

## Open questions

- Does import replace the journal wholesale, or merge per trip/day? This is
  the decision that makes the feature safe or dangerous.
- Zip only, or also a plain folder push over the REST API for agents that
  cannot build archives?
