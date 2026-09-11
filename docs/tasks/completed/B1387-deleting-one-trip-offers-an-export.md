---
id: B1387
title: Deleting one trip offers an export of the whole journal, and the zip carries machine state
type: ISSUE
priority: high
complexity: medium
area: export, deletions, trips
found: "2026-09-10T19:22:38Z"
started: "2026-09-11T08:42:20Z"
merged: "2026-09-11T10:01:18Z"
---

# B1387 — Deleting one trip offers an export of the whole journal, and the zip carries machine state

## Why

Two faults in the same file, both about the export handing over things nobody
asked for.

**One: deleting a trip offers an export of everything.** The deletion mail is
built once for both targets — `lib/deletions.ts:366–389` — and the export
button is unconditional:

```
lib/deletions.ts:378
  href: deletionExportUrl(site.url, summary.username, input.token)
app/[user]/delete/[token]/export.zip/route.ts:41
  const archive = createUserExportArchive(user, "all")
```

`"all"` is every trip in the journal. So somebody deleting one trip — the mail
above it correctly says `del.tripIntro`, `del.tripWhatGoes`, this one trip —
presses "take a copy first" and is handed five years of writing, drafts
included. The copy they wanted is in there somewhere; so is everything they did
not ask for. `lib/exportZip.ts:32` already warns that anything reaching for
`"all"` has to establish it is the owner and not merely inside the journal —
this is the neighbouring mistake, a scope that is right about *who* and wrong
about *what*.

**Two: the zip carries machine state.** `walkFiles` (`lib/exportZip.ts:51`)
takes every file under the trip and the only exclusion is `originals/`
(line 124). On a real journal that means:

```
content/severin/trips/algarve-2026/
  .DS_Store          ← in the zip
  .fingerprints      ← in the zip
  .ingest.json       ← in the zip (AGENTS.md: "do not edit")
  costs.md  entries/  media/  trip.md
```

plus `helper-consent.json` at the root, which is a record of what the *owner*
agreed to with the model and has nothing to do with a trip.

The export is the anti-lock-in promise made concrete. A zip a person opens and
finds `.fingerprints` in is one they cannot tell the content from the plumbing
in, and the point of it was that they could.

## Work

**Scope.** Give `ExportScope` a trip-scoped value, or take an optional trip id
alongside it — the builder's call, but one shape, not two overlapping ones.
Thread it from `requestDeletion` through `deletionExportUrl` and the
`/<user>/delete/<token>/export.zip` route so the deletion mail's button offers
exactly what that mail is about. The whole-journal deletion is unchanged and
still offers `"all"`.

The token already knows its own target — `DeletionTarget` in
`lib/deletions.ts:54` — so prefer reading the scope off the resolved token
rather than putting a trip id in the URL, which would be a second thing to
validate against a directory name.

**Layout.** The zip's paths become `content/<user>/trips/<trip>/…`, so
unzipping at the checkout root puts everything where it belongs and a zip found
on a disk a year later says what it is. That changes the restore instruction
from "unzip into `content/<username>/`" to "unzip at the root" — update the
module comment at `lib/exportZip.ts:15–19`, `scripts/export.mts`, and anything
in `docs/` or `lib/api/documentation.ts` that repeats the old one.

**Exclusions**, per the author:

- Every dotfile and dot-directory, at any depth. One rule, so `.fingerprints`,
  `.ingest.json`, `.DS_Store` and whatever appears next are all covered without
  a list that is always missing its next entry.
- `helper-consent.json` — out of every export, not merely out of a trip one.
- `originals/` stays excluded, as today.

**Open, and not decided by the author:** whether `config.json` belongs in a
single-trip export. It carries the owner block. Leaving it out makes the zip
less self-describing; leaving it in puts the owner's own details in an archive
about one trip. Ask before building, or leave it out and say so.

Not in scope: the `"open-to-link"` scope, which no HTTP route serves (B1086),
beyond keeping it working.

## Acceptance

- A trip deletion mail's export button downloads a zip containing that trip and
  no other.
- A journal deletion mail's export button still downloads the whole journal.
- Every path in either zip starts `content/<user>/`.
- No entry in either zip has a path segment beginning with `.`; no
  `helper-consent.json`; no `originals/`.
- Test in `test/` pinning all four of the above — the current suite pins the
  contract and should keep doing so.
- The restore instruction is corrected everywhere it appears; `npm run verify`
  passes.
