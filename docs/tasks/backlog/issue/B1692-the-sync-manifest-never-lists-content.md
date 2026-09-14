---
id: B1692
title: The sync manifest never lists content/<user>/figures/
type: ISSUE
priority: medium
complexity: low
area: sync, api
found: "2026-09-14T05:05:40Z"
---

# B1692 — The sync manifest never lists content/<user>/figures/

## Why

Found during B1512, driving `GET /api/v2/<user>/sync/manifest` against the
live instance and comparing it to `content/example` in the repository.
`content/<user>/figures/*.json` — a traveller's own likeness, up to ten
per journal, created and edited through `PUT /api/v2/<user>/figures/{id}`
and referenced by a trip's or a day's `figures` block — never appears in a
manifest. `content/example/figures/` holds 12 files on disk; the manifest
for `example` lists 0.

`lib/sync/manifest.ts`'s `inSync()` (line ~184 onward) is an allow-list at
the top level: `config.json`, `trips/**`, and `inbox/**` (length >= 3). A
top-level `figures/` segment matches none of those, falls through to
`if (root !== "trips") return false;`, and is silently dropped — not
because anyone decided figures should be excluded, but because the
function was never told about the directory.

This is a different kind of omission from `gps/`, `postcards/`,
`photobooks/` and `originals/`, all of which are deliberately excluded and
say so in the module's own doc comment, and `originals/` is even reported
back to the caller via `manifest.omitted`. `figures/` gets neither: it is
not named as excluded, and the client is never told it exists and was
skipped. A person restoring a journal from `sync/manifest` + `sync/file`
alone loses every traveller figure with no signal that anything is
missing — the manifest's own `next` message only ever mentions
`originals` as what was left out.

## Work

Decide whether figures belong in the manifest (they are owner-authored,
non-derived content addressed by id, the same shape as a trip's `plan.md`
or `costs.md`, which do sync) or are meant to be excluded like the
generated folders. If included: add a `figures` case to `inSync()` next to
the `trips`/`inbox` cases. If deliberately excluded: name it in
`EXCLUDED_ROOTS` and add it to the manifest's `omitted` reporting the same
way `originals` is, so a client knows to ask for it another way rather
than silently ending up without it.

**Not in this ticket:** any other directory under `content/<user>/` that
might have the same gap — this ticket is scoped to the one directory found
live during B1512.

## Acceptance

- `buildManifest("example")` either lists every file under
  `content/example/figures/`, or `manifest.omitted` names `figures` the
  way it already names `originals`.
- A test asserts one of the two, the way `test/gps-store.test.ts` asserts
  `gps/` is never reachable.
