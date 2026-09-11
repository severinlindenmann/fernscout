---
id: B1495
title: A journal can be synced down to a folder and back up, incrementally
type: FEATURE
priority: medium
complexity: high
area: API, helper, content
found: "2026-09-11T17:22:53Z"
started: "2026-09-11T18:25:09Z"
merged: "2026-09-11T19:06:06Z"
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


## Researched, 2026-09-11 — the decisions the Work section asked for

Written before any route exists, as the ticket requires. Each one is grounded
in code read in this branch, with file:line.

### 1. What identifies a version

**A manifest entry is `{ path, size, hash }`, and the hash is
`contentHash` — `lib/ingest/hash.ts:156`, SHA-256 over the whole file, hex,
truncated to 32 characters.** It is already in this codebase, it is already
what ingest means by "the same file again", and the inbox already names files
by the same digest (`lib/inbox.ts:152`, 12 characters of it). One hash
function, three callers.

**Not `sampledFileHash`** (`lib/ingest/hash.ts:167`), even for video, and this
is the one place the cheap answer is the wrong one. A sampled hash that
collides means ingest skips an import — a photograph you have to add again. A
sampled hash that collides *here* means a changed file is silently never
synced, in either direction, and both sides go on believing they agree. The
failure is invisible and permanent, which is the class of harm this
repository's rules are mostly about.

**Full hashing is affordable, measured rather than assumed.** SHA-256 over the
whole of `content/example` — 153 files, 22.1 MiB — is 45 ms on this machine,
497 MiB/s, which extrapolates to **2.1 s per gigabyte**, cold and
single-threaded. That is the worst case; it is paid once.

**`mtime` is not in the manifest.** It is in the *cache key* and nowhere else.
A modification time does not survive `export.zip` (the fresh-sync path), does
not survive a copy, and does not agree between a server and a laptop, so a
manifest carrying it would be a field that disagrees on every run and has to be
ignored — which is a field that should not be there. Both sides instead keep a
private hash cache keyed on `(size, mtimeMs)`, so an unchanged file is a
`stat()` rather than a read. That is the ticket's own suggested out and it
needs nothing on the wire.

`size` stays in, though it decides nothing on its own: it is free, and it is
what lets a run print *"412 files, 180 MB will move"* before it moves them.

### 3. Generated output is out — and the export disagrees with that today

`postcards/`, `photobooks/`, `.ingest.json` and `track.json` are out of the
manifest, as decided. Two findings the ticket did not anticipate:

**`track.json` is in `export.zip` today.** `appendUserContent`
(`lib/exportZip.ts:148-162`) walks the whole of `trips/<id>/` and filters only
`originals/` and dotfiles; `track.json` is neither, and the string does not
appear in the file at all. So the fresh-sync path unzips a file the manifest
excludes. The client must therefore **delete `track.json` after unzipping**,
not merely decline to list it — otherwise the first `sync up` sees a local file
the server's manifest does not have, and offers to push a derived file back at
the thing that derives it.

**`originals/` is a third category the ticket never names, and it is out.**
`lib/exportZip.ts:152-156` already excludes it in every scope, with the reason
written beside it: it is what the photobook prints from, an order of magnitude
larger than what the site serves, and back it up with the filesystem rather
than through a browser. Owner decision 2 (media syncs as derivatives) points
the same way. So sync does not carry it — **and the run prints that it did
not**, by count and by bytes. A mirror that silently omits the largest thing on
disk while calling itself a backup is the "no silent caps" failure, and the
whole cost of avoiding it is one line of output.

### 5. The base manifest on disk

`.fernscout-sync.json` in the local root, as the ticket names it. Gitignored,
and — more importantly — **excluded from the walk**, so it can never be
uploaded by the thing that writes it.

```json
{
  "version": 1,
  "instance": "https://fernscout.ch",
  "user": "example",
  "syncedAt": "2026-09-11T18:40:00Z",
  "files": {
    "trips/alps-2024/trip.md": { "size": 1731, "hash": "…32 hex…", "mtimeMs": 1757... }
  }
}
```

`mtimeMs` is the local hash cache and is never compared against anything the
server said; it exists so the next run can skip re-reading a file whose size
and mtime are unchanged.

Three-way compare, base vs local vs remote, per path:

| base | local | remote | action |
| --- | --- | --- | --- |
| = | = | = | nothing |
| = | = | ≠ | pull |
| = | ≠ | = | push |
| = | ≠ | ≠, and local ≠ remote | **conflict — stop, name it, write nothing** |
| = | ≠ | ≠, and local = remote | nothing; both were edited the same way |
| present | gone | = base | delete on the server, after confirmation |
| present | = base | gone | prune locally, after confirmation |
| absent | present | absent | push (new local file) |
| absent | absent | present | pull (new remote file) |

The two "both sides changed" rows are the reason the base manifest exists at
all: without it, "we differ" and "you changed it" are the same observation.

**The deletion threshold, since the ticket asks for a number.** A run that
would delete **more than half the files on that side** is refused outright,
with a sentence saying so and what to do instead — not confirmed, refused. Half
is the shape of an accident rather than an edit: a wiped folder, a `--root`
pointing at the wrong directory, an unzip that half-finished. Below it, the run
lists every path it would delete, on which side, and waits. An absolute count
was the other candidate and is worse: deleting a trip with forty photographs in
it is an ordinary thing to do on a large journal and a catastrophe on a small
one, and only a proportion knows the difference.

### 2. The doors — the biggest question, answered smaller than it was asked

The ticket guessed `GET .../sync/manifest` plus a per-file `GET`, `PUT` and
`DELETE`, and told the branch to check first whether the existing routes can
carry the up leg. They can, almost entirely. **Two new routes ship, not four:
a manifest, and a read-only file `GET`. There is no file `PUT` and no file
`DELETE`.**

**The up leg goes through the typed routes that already exist**, because
walking the tree kind by kind shows there is nearly nothing they cannot write:

| File | Written today by |
| --- | --- |
| `trips/<id>/trip.md` | `POST .../trips`, then `PATCH .../trips/<trip>` and the doors for `visibility`, `people`, `travellers`, `rates`, `tracks` |
| `trips/<id>/entries/*.md` | `POST .../days`, `PATCH .../days/<slug>`, `publish`, `unpublish`, `DELETE` |
| `trips/<id>/costs.md` | `GET`/`PUT`/`PATCH`/`DELETE .../costs` |
| `trips/<id>/plan.md` | `GET`/`PUT .../plan` |
| `trips/<id>/media/*` | `POST`/`DELETE .../media` |
| `inbox/**` | `POST`/`DELETE .../inbox`, and `GET .../inbox` already returns each file's full SHA-256 |
| `config.json` | `PATCH .../config`, minus three fields it refuses on purpose |

And what a raw byte `PUT` on a day would bypass is not a detail. Reading
`lib/validate/entry.ts` and `lib/api/entries.ts`: required fields and their
shapes, a date that is a real calendar date, `TRANSPORT_MODES`, currency codes
on every cost line, the B294 rule that every declared locale carries a
translation, the gallery check that a caption or a per-photo visibility names a
photograph the day actually has, the slug collision check that catches two
titles folding to one slug, `checkAgainstContract` refusing an undocumented
key, `EDITABLE_DAY_FIELDS` keeping `status` out of a `PATCH` so a day cannot be
published except through the publish door — and `checkWeather`, which refuses
a caller supplying its own reading.

That last one decides it on its own. **A file `PUT` would be a door through
which an agent could write a temperature nobody measured**, straight past the
one rule this project is built on, and it would do it by design rather than by
bug. Everything else on that list is a reason; this one is a refusal.

So the up leg is: the client diffs, then calls the same typed routes `publish`
already calls. It gains nothing from a file door and loses the validators.

**The two routes that do ship**, both bearer-only, both `mayActAsOwner`, both
answering `404` rather than `403` — copied from `app/[user]/export.zip/route.ts:54`
exactly as the ticket asks, so a trip-scoped token is refused by construction
and no new gate is invented:

- `GET /api/v1/<user>/sync/manifest` — every path, size and hash.
- `GET /api/v1/<user>/sync/file/<path>` — one file's bytes, for the down leg.
  Read-only. `inSync()` gates the path, so the same rule that decided the
  listing decides what is fetchable; a path it refuses is a 404 whether it was
  guessed or listed.

**Deletions on the server go through the typed delete routes too**, which is
what makes owner decision 4 safe rather than merely confirmed: deleting a day
is `DELETE .../days`, which already refuses a published day and already has its
own confirmation handshake. Sync never deletes a file the API would not delete.

**Two gaps found, and neither blocks this ticket.** Both are captures rather
than scope absorbed here:

- **`POST .../trips/<trip>/media` requires a day that already exists**
  (`dayProblem`, `app/api/v1/[user]/trips/[trip]/media/route.ts:87`), and
  `DELETE` only detaches a photograph from a day's gallery. A media file on
  disk belonging to no day — which a folder sync can legitimately hold, and
  which `cover:` needs before the day it came from is written — has no door.
  The down leg is unaffected; the up leg cannot push such a file today.
- **`config.json`'s `owner.email`, `baseCurrency` and `media` have no door**
  and are refused on purpose (`app/api/v1/[user]/config/route.ts:219`), each
  with its reason written beside it. A local edit to one of those cannot
  reach the site, so the up leg must **say so** rather than report success —
  the same honesty `publish` already owes and, per the helper research, the
  same stale-warning machinery it already has for trip fields.

**No route anywhere under `app/api/` takes a content hash or an `If-Match`
today** — searched. The ticket's "nothing lists a journal's files with hashes"
is confirmed exactly.

### 4. Fresh sync

`/<user>/export.zip` in its `all` scope is byte-faithful for everything it
carries: `lib/exportZip.ts:148-162` adds each file with `archive.file()`, so
no re-encoding, no rewritten frontmatter, no normalised line endings, and the
only path change is a POSIX slash-join of the same relative path. Hashes
computed from an unzip therefore agree with the server's own. Drafts are in
(the `all` scope keeps them); `gps/` is not in it in any scope, and
`test/gps-store.test.ts` already proves that against a real archive.

Two corrections the client must make after unzipping, both from findings
above: **delete `track.json`**, which the export carries and the manifest
excludes, and **expect no `originals/`**, which the export already excludes.
Without the first, the next `sync up` sees a local file the server's manifest
lacks and offers to push a derived file back at the thing that derives it.

### 5. The inbox gap — a second call, not a wider export

Decided as the cheaper of the ticket's two options, and it is barely a cost at
all: `GET /api/v1/<user>/inbox` already returns every staged file's metadata
**including its full SHA-256** (`lib/inbox.ts:198`), so the listing the
manifest needs exists. What is missing is only the bytes — and the new
`sync/file` `GET` above covers `inbox/**` along with everything else, because
`inSync()` admits it. So the inbox costs **nothing extra**: no widening of
`lib/exportZip.ts`, no change to the export's contract, no new door beyond the
one the down leg already needs.

Widening the export was the alternative and is worse: it reaches into a
file-walk shared with the deletion mail and the trip-scoped narrowing, and it
would force a decision about whether `.meta.json` sidecars count as the
bookkeeping that walk strips — a change with blast radius, to avoid a call
that is already being built.

### 6. Which helper skills this thins

Read in the sibling repository:

- **`publish` — subsumed**, as the ticket decides: it becomes the up leg with
  its name, flags and docs intact. Worth knowing before that refactor: it does
  **no hashing at all** today. Days are matched by a recorded `slug:`, then by
  `date|title`, then by an unambiguous date guess, and a matched day is
  re-`PATCH`ed unconditionally whether or not its bytes changed; photographs
  are compared by filename alone, so a changed photograph under the same name
  is never re-sent. A manifest fixes both, and that is the real prize.
  `publish.test.mjs` drives the CLI surface and asserts on exact stdout
  phrasing and request order, so the wrapper must keep its flags and its words.
- **`validate-content` — fed.** `publish.mjs:111` already gates on it before
  sending anything, and that gate stays; sync makes the folder it validates
  genuinely current rather than a guess.
- **`trip-budget` — fed.** It edits `costs.md` and day frontmatter purely on
  disk and calls no API; sync is what turns those edits into something on the
  site.
- **`icloud-export` — fed.** It writes days and media into the local tree and
  makes no API call; sync is how its output arrives.
- **`shared` — fed, and reused rather than replaced.** `readJournal()` is the
  tree walk the up leg needs and `call()`/`token()` are its transport.
- **`gps-history` — unrelated**, and must stay so: it uploads a history
  through `POST .../import` and sync never touches `gps/`.
- **`statement-costs` — unrelated.** Its door is the import route because
  categorising a payment is an editorial decision the server takes after a
  person agrees, which is exactly the thing a file diff must not do.

### Stale prose to fix in the same run

The ticket asks for it, and the helper research found it in three places, all
saying a trip's fields cannot be corrected: `publish/SKILL.md:25-31`,
`publish/SKILL.md:201`, and the comment plus the warn-only branch at
`publish.mjs:395-418`. All three are now wrong — `title`, `tagline`, `start`,
`end`, `cover`, `accent`, `costsVisibility`, `intro` and, since **B1496**
today, `translations` are every one of them correctable through
`PATCH /api/v1/<user>/trips/<trip>`. They should patch rather than warn.

## Work

The six research questions are answered above, from code read in this branch.
What is left is building it, and the shape came out **smaller than this ticket
guessed**: two read-only routes here, and the up leg through the typed routes
that already exist. There is no file `PUT` and no file `DELETE`.

**In this repository:**

1. `lib/sync/manifest.ts` — the walk, the exclusions and the hash. One
   exported predicate, `inSync()`, decides what is in; the listing and the
   file door both ask it, so a path refused by one is refused by the other.
2. `GET /api/v1/<user>/sync/manifest` and
   `GET /api/v1/<user>/sync/file/<path>`. Bearer only, `mayActAsOwner`, 404
   rather than 403 — the `export.zip` gate, copied rather than reinvented.
3. `test/gps-store.test.ts` grows the assertion decision 1 asks for: the
   manifest module is unreachable from `lib/gps/`, and a manifest built over a
   journal with a real position history names neither the folder nor a
   coordinate in it.
4. The contract, per `keep-the-contract`: both routes in `lib/api/openapi.ts`
   with a refusal documented beside each success.

**In `fernscout-helper` (the client, and a separate piece of work):** the
`sync` skill, with `publish` becoming a thin wrapper over its up leg — keeping
its flags and its exact stdout phrasing, which `publish.test.mjs` asserts on.
The stale B245 prose at `publish/SKILL.md:25-31`, `publish/SKILL.md:201` and
`publish.mjs:395-418` is corrected in the same run: those fields all have a
door now, `translations` included since B1496, so the client patches rather
than warns.

**Not in this ticket:** a daemon or watcher, file locking, multi-machine
concurrency beyond the conflict stop, a public/guest scope (owner only), and
GPS in any form.

**Captured, not absorbed** — two gaps the research found, each a real hole and
neither this ticket's to fill: B1503 (a media file belonging to no day has no
door) and B1504 (the up leg must say out loud that three `config.json` fields
can never reach the site).

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

## Evidence, 2026-09-11

`npm run verify` green (535 files, 7008 tests, knip clean). New: 18 tests in
`test/sync-manifest.test.ts`, 3 in `test/gps-store.test.ts`, and both routes in
`/openapi.json` with refusals.

Driven against a running instance on content that existed before the branch —
`content/example`, five real trips, **153 files and 23 MB**. A throwaway
down-leg client (`scratchpad/sync.mjs`, not shipped) reads the manifest, diffs
against a base manifest on disk, prints its plan, and fetches only what
differs. Captures: `B1495-acceptance.txt` and `B1495-acceptance-2.txt`.

- **Fresh sync into an empty folder:** 153 files pulled; every file's bytes
  re-hashed on arrival and checked against what the manifest said, so the
  transfer is verified rather than assumed.
- **A second run with nothing changed:** `pull 0 (0 bytes), unchanged 153`.
- **One day changed on the site, then sync again:**
  `pull 1 (1499 bytes), unchanged 152` — from the run's own printed plan, not
  asserted. Both the English prose and the German and Hungarian came down with
  it.
- **Both sides changed the same file:** named the path, wrote nothing, exited
  non-zero, and the local file's checksum was unchanged afterwards.
- **A local-only edit is not a conflict** — it plans as `local-only 1` and the
  laptop's own line survives the sync down, which is the guard-that-fires-on-an-
  honest-run case.
- **A draft day is in the manifest:** two of them, in `japan-2027`.
- **`gps/`:** with a real `gps/2026-06.jsonl` on disk carrying a coordinate,
  the manifest mentions neither `gps/` nor the coordinate, and the file door
  answers **404**. So do `originals/` and a path climbing out of the journal.
- **A trip-scoped token:** 404 from both routes. No token at all: 401.

**Two harness bugs, found and fixed before anything was reported.** The first
run's step 2 looked like it passed and had not: the day edit was refused,
because this journal is read in three languages and a day must carry all of
them, so nothing had changed and "only that file moved" was vacuously true.
The same run called a local-only edit a conflict, because the rule compared
local against base without asking whether the remote had moved at all. Both
were in the throwaway client rather than in shipped code; the reruns above are
the honest ones. Recorded because a green-looking step that exercised nothing
is exactly what B1090 is about.

The example content edited during the run was restored (`git checkout --
content/`, clean afterwards).

## Still to build

This ticket is the **server half**. The `sync` skill in `fernscout-helper` —
and `publish` becoming a wrapper over its up leg, with the stale B245 prose
corrected — is the other half and is not in this branch. The decisions it needs
are all written above.

## The security pass, and three things it changed

Run before merging, as AGENTS.md asks for anything touching auth or an API
route. Three defects in this branch's own code, all fixed here rather than
captured — a problem this branch created is not a ticket for somebody else.

**1. The exclusions were case-sensitive, on a case-insensitive filesystem.**
Found by probing `inSync` directly rather than by reading it:
`trips/<id>/ORIGINALS/01.jpg` and `TRACK.json` both returned `true`, and on
APFS they resolve to the real files — so the folder would have been excluded
from the listing and then served to anybody who asked in capitals. Every
comparison now folds case, and `test/gps-store.test.ts` pins the shouted
spellings beside the quiet ones.

This is the shape a test written beside its own implementation cannot catch,
because the fixture spells the path the way the code does. Worth remembering:
`gps/` itself was never at risk, but only because the walk is an **allow-list**
— `GPS/` is refused for not being `trips` or `inbox`, not for matching the
exclusion. Default-deny is what made the near-miss a near-miss.

**2. The symlink boundary was a tautology, and its comment said otherwise.**
`resolveSyncPath` ended with `full.startsWith(root + sep)` under a comment
claiming it stopped a symlink leaving the journal. It did not and could not:
`inSync` has already refused every `..`, so `path.join` starts with `root` by
construction, and `path.join` never touches the filesystem anyway. It is now
`fs.realpathSync` on both sides, which resolves the whole chain — and there is
a test that puts a real symlink inside a journal pointing out of it and checks
both that the file door refuses it and that the listing never offered it.

Not a live hole: nothing in this codebase creates a symlink under `content/`,
and the manifest walk skips them anyway (`Dirent.isFile()` is false for a
link). It is fixed because the next thing that *does* write one — an importer,
an upload that preserves links — would have inherited a guard that was only
ever decorative.

**3. A doc comment described a branch the code does not have.** The manifest
route claimed a wrong-journal token gets `outOfScope`; every refusal is in fact
the same 404. The code is the stricter of the two and stays; the comment now
says what it does and why.

Two things the pass confirmed rather than changed: the gate order is
`authenticate` → `ownsUser` → `mayActAsOwner` with no branch returning data
early, matching `export.zip`; and the double-decode on the file door could not
be turned into a traversal, since `inSync` runs after the decoding. The extra
`decodeURIComponent` was removed regardless — Next has already decoded, and the
sibling catch-all routes rely on that — because a second pass would mangle a
filename legitimately holding a `%`.

**Noted, not fixed:** `hashCache` is unbounded and process-lifetime. It is one
short string per file of journals the instance already serves, it is not
attacker-amplifiable, and an eviction policy would be more code than the thing
it manages — the reasoning is written beside it. Revisit if an instance ever
holds many journals for a long time.
