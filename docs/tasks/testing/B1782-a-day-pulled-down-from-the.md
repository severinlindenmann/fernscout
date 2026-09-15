---
id: B1782
title: A day pulled down from the instance cannot be written back, because it carries the server's own weather source
type: ISSUE
priority: high
complexity: low
area: fernscout-helper publish, validate-content
found: "2026-09-15T06:42:48Z"
started: "2026-09-15T06:43:41Z"
merged: "2026-09-15T07:09:18Z"
---

# B1782 — A day pulled down from the instance cannot be written back, because it carries the server's own weather source

## Why

A day the instance looked the weather up for comes back carrying the reading
it found, with `source: "open-meteo"`. `sync down` writes that document
straight to disk — it is a byte mirror — and every write route then refuses it
by name: `weather.source: "this source name is the server's own — a caller may
never claim it"` (`lib/api/v2/schemas/day.ts:79`). So a folder that has been
synced down can no longer create its own days: 189 entries in one journal are
in that state.

The decision itself is right and is not in question — "a client forwarding a
journal skips open-meteo entries rather than sending them back" is written into
`day.ts:303`, and B1713 already made the PATCH-merge case work so that
correcting such a day is possible. What is missing is the client half, and it
used to exist: **B1580 shipped it in this helper and the B1715 v2 rewrite lost
it.** `publish.mjs` does not mention weather anywhere, and the only remaining
mention in the repository is the hardcoded `source === "open-meteo"` in
`convert.mjs:143` — the exact hand-kept copy B1580 removed.

## Work

Before any write, turn a reading whose source is one the instance reserves back
into `weather: true` — which is the ask that produced it — and say so once per
run rather than once per day. One place, in `shared/`, used by both
`publish.mjs` and `validate-content`'s dry run, because the two must agree
about what a writable document is.

The reserved names are read from the instance (`/api/health`'s
`weather.reservedSources`, and see B1783), not typed here. An instance too old
to publish them falls back to `open-meteo` and the run says so — that is
B1580's own wording and it should be restored, not reinvented.

The local file keeps the reading. It is real data the instance measured, the
folder is its mirror, and stripping the disk copy would lose it.

## Acceptance

`publish` and `validate-content` against a journal synced down from an instance
that filled in weather send `weather: true` for those days, are not refused,
and print one line saying how many readings were left to the server. The
hardcoded source name in `convert.mjs` is gone.

## Built, 2026-09-15 — fernscout-helper `aa69dbd`

**Valid when taken**: `publish.mjs` mentioned weather nowhere, and the only
remaining mention in the repository was the hardcoded `source === "open-meteo"`
in `convert.mjs:143` — the copy B1580 had removed, back again after the B1715
rewrite.

`asWritten()` in `shared/api.mjs` turns a reading whose source is one the
instance reserves back into `weather: true`, and both `publish.mjs` and
`validate-content` use it, because the two have to agree about what a writable
document is. The names come from `/api/v2/status` (B1783); an instance that
does not publish them falls back and the run says so, once. The file on disk
keeps the reading — it is real data the instance measured and the folder is its
mirror.

`convert.mjs` has no copy of its own any more: it imports the single
`FALLBACK_RESERVED_SOURCES` constant, which is the only place the name appears
in the repository outside prose.

Keeper: four checks in `publish.test.mjs` — what goes up is `weather: true`,
the run says how many, and the file still holds the reading.
