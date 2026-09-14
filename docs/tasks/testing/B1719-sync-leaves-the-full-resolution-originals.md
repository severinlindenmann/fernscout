---
id: B1719
title: Sync leaves the full-resolution originals on the server, so a pull restores the journal at a quarter of the pixels
type: FEATURE
priority: high
complexity: low
area: sync, media
found: "2026-09-14T09:41:00Z"
started: "2026-09-14T10:27:19Z"
merged: "2026-09-14T10:35:59Z"
---

# B1719 — Sync leaves the full-resolution originals on the server, so a pull restores the journal at a quarter of the pixels

## Why

`inSync()` in `lib/sync/manifest.ts:214` refuses any path whose third segment
is `originals`, so `GET /api/v2/{user}/sync/manifest` never lists a master and
`GET .../sync/file/trips/<trip>/originals/<day>/01.jpg` answers 404
(`resolveSyncPath` asks the same function). The manifest says so out loud
rather than hiding it:

```json
"omitted": { "originals": { "files": 361, "bytes": 669530691 } }
```

Measured on one real photograph of the migrated journal (B1715), all three
copies side by side:

| | bytes | dimensions |
| --- | --- | --- |
| pulled through `sync/file` | 346,262 | 1500 × 2000 |
| the local `media/` copy | 332,450 | 1500 × 2000 |
| the local **original** | 2,115,458 | **3000 × 4000** |

So a pull restores the journal — every day, every translation, the trip
documents, the config, 778 files — and restores the photographs at a quarter of
the pixels. After the migration the 3000 × 4000 masters exist in exactly two
places: the owner's Desktop folder, and a server store nothing can retrieve.

The exclusion's own comment defends it as "back them up with the filesystem,
not through a browser", quoting `lib/exportZip.ts`. B1603 has already overruled
that reasoning for the exports, for the reason that applies here too: a hosted
owner has no shell on the server, so "the filesystem" is not somewhere they can
reach. Sync is the other half of the same gap.

**Owner's decision, 2026-09-14:** originals belong in the sync. A first pull
being large is acceptable; what matters is that a *repeat* pull is not — nobody
should re-fetch 100 GB nightly, and an owner paying for that storage will keep
the folder small anyway. The manifest is already built for this: an entry is
`{path, size, hash}` over the whole file, so a client compares hashes and
fetches only what changed, and `hashCache` turns an unchanged file on the
server into a `stat()`.

## Work

- Drop the `originals` line from `inSync()`. That is the whole of the
  behaviour: the listing, `resolveSyncPath` and the file door all read the same
  function, which is why it was written as one.
- Retire `omitted.originals` and `countOriginals()` with it — there is nothing
  left to report — and take `omitted` out of `SyncManifest`, the v2 schema and
  `/api/v2/openapi.json`, or leave the key as an empty object if a client is
  known to read it. Say which and why in the merge.
- Rewrite the manifest's `next` prose and `sync/SKILL.md`: a pull is now a
  complete copy of the photographs, and the first one is large. Name the byte
  total in the manifest so a client can warn before it starts.
- Check the cost of hashing on a large journal once, on the live box, and write
  the number down. SHA-256 over `content/example` measured 45 ms for 22 MiB
  (~500 MiB/s), so 669 MB is about 1.3 s on the first manifest and a walk of
  `stat()`s afterwards — confirm that rather than assume it, because this is the
  request that now touches every byte the instance stores.
- Not doing: the push half. v2 sync is `GET`-only on both doors and writes go
  through the media routes; uploading an original is B1715's problem, not this
  one.
- Not doing: `gps/`, `postcards/`, `photobooks/`, `track.json`, `.ingest.json`
  or dotfiles. Every other exclusion stands, and `gps/` in particular is never
  to be crossed.

## Acceptance

- `GET /api/v2/{user}/sync/manifest` lists every file under
  `trips/*/originals/`, with its size and hash.
- `GET /api/v2/{user}/sync/file/trips/<trip>/originals/<day>/01.jpg` answers
  the 3000 × 4000 file, byte-for-byte identical to the one on disk.
- A second manifest for an unchanged journal is served without re-reading the
  originals (the cache holds), and a client diffing two runs plans zero
  transfers.
- `gps/` is still refused, by the same function, with a test that says so.
- The published contract no longer promises an `omitted.originals` count that
  is always zero.

---

## Revalidated, 2026-09-14 — valid

`lib/sync/manifest.ts:214` refused any path whose third segment was
`originals`, and `resolveSyncPath` asks the same function, so the listing and
the file door were shut together — exactly as the ticket says.

## Done, 2026-09-14

One line of behaviour, as expected, and four things around it:

- the `originals` refusal is gone from `inSync()`, so the manifest lists the
  masters and `GET .../sync/file/...` serves them;
- `omitted`/`countOriginals` are retired — from `SyncManifest`, from the
  manifest route, and from the `syncManifest` schema that generates
  `/api/v2/openapi.json`. Nothing left to report, and a key that is always
  `{files: 0, bytes: 0}` is a contract promising something untrue;
- the manifest's `next` line and the operation's summary now say a pull is the
  whole journal, that a first one is as large as the journal really is, and
  that a later one carries only what changed;
- the case-sensitivity comment in `inSync` kept its rule and changed its
  example: `ORIGINALS/01.jpg` was the case that proved it and is no longer an
  exclusion, so it now reads on `GPS/`, which is the folder that must never be
  reachable.

Three tests inverted rather than deleted, which is the point of them:

- `sync-manifest.test.ts` asserted originals were excluded *and the count
  reported*; it now asserts the master is listed at its real size with a
  32-character hash, and comes back byte-for-byte through the file door;
- "a file the manifest does not list is refused, even though it is on disk"
  used `originals/` as its example and now uses `gps/`, which is the better
  example anyway;
- the "shouted path" case (`ORIGINALS/01.jpg` on a case-insensitive
  filesystem) moved to `GPS/`, keeping the guard that found it;
- `gps-store.test.ts`'s refused/allowed lists moved `trips/*/originals/*`
  across, so the one test that reads as the whole boundary still does.

`npm run verify` — all 5 passed.

**Not yet done, and it is an acceptance line:** the hashing cost measured on
the live box, and the byte-for-byte 3000×4000 fetch against a real journal.
Both need the deploy.
