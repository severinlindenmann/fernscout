---
id: B1603
title: Journal and trip exports drop the original photo/video files
type: ISSUE
priority: high
complexity: medium
area: exportZip, deletions
found: "2026-09-12T17:35:27Z"
---

# B1603 — Journal and trip exports drop the original photo/video files

## Why

`appendUserContent` in `lib/exportZip.ts:150-156` skips any path whose first
segment under a trip root is `originals/`, in every scope. That function
backs **both** exports that actually leave the server over HTTP:

- `/<username>/export.zip` — the owner's voluntary backup
  (`scripts/export.mts` calls the same function locally).
- `/<username>/delete/<token>/export.zip` — the single-use export a person is
  mailed before a whole-journal or single-trip deletion actually runs
  (`lib/deletions.ts`), which is the *last* chance to get a copy of anything
  before it is gone for good.

The comment defends this as deliberate: originals are "an order of magnitude
larger" than the derivatives the site serves, and says to "back them up with
the filesystem, not through a browser." That is a reasonable position for the
everyday backup export, but it fails exactly the case the deletion export
exists for: a hosted journal's owner has no filesystem access to
`content/<user>/trips/<trip>/media/originals/` (AGENTS.md is explicit that a
hosted owner has no shell on the server), so "back it up with the
filesystem" is not an option available to them. A person who deletes a trip
or a journal and only later realises the export left out every original
photo has permanently lost the print-quality master — the thing
`lib/media.ts`'s own upload path (B1533) goes out of its way to preserve
losslessly for exactly this reason (a photobook print, or simply a better
copy than the resized derivative the browser was ever served).

## Work

Drop the `originals/` exclusion in `appendUserContent`
(`lib/exportZip.ts:156`) for both the whole-journal export and the
trip-scoped deletion export, so `media/originals/**` is walked and added to
the zip the same way every other trip file already is. Per the answered
questions on this ticket:

- Apply to **both** export paths (`/<username>/export.zip` and
  `/<username>/delete/<token>/export.zip`), not only the deletion one.
- Accept the size/time cost as-is rather than redesigning the export
  mechanism (no async job, no separate download link) — if a large originals
  folder makes generation slow, that is an acceptable tradeoff over silently
  discarding data, and can be revisited as its own ticket if it turns out to
  actually break the deletion flow's 1-hour token TTL in practice.
- Everything else the function already excludes (dotfiles, `config.json` on
  a trip-scoped export, drafts under `open-to-link`) is unaffected — this is
  only about the `originals/` skip.

Not in scope: changing what the *derivative* export contains, or building any
kind of streaming/chunked download for very large originals folders.

## Acceptance

- A trip with files under `trips/<trip>/media/originals/` produces a zip
  (via `buildUserExportZipBuffer` or an HTTP export route) that contains
  those files at `trips/<trip>/media/originals/...`, in both the `"all"` and
  `"open-to-link"` scopes, and for both the whole-journal and trip-scoped
  (`tripId` given) export.
- `test/export.test.ts` gains/updates a case asserting originals are present
  rather than absent.
- The deletion-mail export (`/<username>/delete/<token>/export.zip`) for a
  journal with originals actually contains them — verified against a real
  deletion token, not only the library function.
