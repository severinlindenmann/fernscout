---
id: B663
title: There is nowhere to put a file before it belongs to a day
type: FEATURE
priority: high
complexity: high
area: media, storage, api, me-page
found: "2026-09-07T07:39:23Z"
started: "2026-09-07T07:41:05Z"
session: 52155fa5-6d95-440e-9de1-0e41d34e7f3d
claimed: "2026-09-07T07:41:05Z"
---

# B663 — There is nowhere to put a file before it belongs to a day

## Why

Every file that enters a journal has to name the day it belongs to before it
is allowed in. `storeUploads` (`lib/api/media.ts:171`) refuses a slug that
names no day — *"write the day first"* — which is right for the pipeline and
wrong for the way somebody actually works: they come back from a week away
with two hundred photographs, and the days that will hold them do not exist
yet. So the order is forced: write the prose, then find the pictures that go
with it, one day at a time, in one long session with an agent.

**Nothing can be handed over early.** A person cannot empty a camera into the
journal on the evening it happened and write the day a week later. An agent
cannot be told "here is everything from the trip, work out which day each one
belongs to", because there is nowhere to put "everything" while it works.

**And it forecloses the things that are not photographs.** A bank statement to
be read into a trip's costs, a CSV of GPS points, a scan to be described — all
of them are files that arrive *before* anybody knows which day they concern,
and several of them never become a gallery item at all. Today the content
model has one door and it is a day's gallery, so none of these has a first
step.

Related: B661 built the ceiling this will be counted against, and B664 is the
page that shows what is using it.


## Work

Built as described, with one change of shape recorded below.

**`content/<username>/inbox/`**, four subfolders — `media/`, `files/`,
`photobook/`, `postcards/` — and `lib/inbox.ts` is the whole vocabulary.
Inside the journal folder on purpose: it is the owner's content, it is in
their backup and their export, and B661 already counts it against the ceiling.

**The name is the content.** `<sha256[0..12]>-<safe-stem><ext>`. The same bytes
under the same name resolve to the same id, so a second upload is a no-op that
returns the first one's id and `duplicate: true`; two different files sharing a
name get different prefixes and both survive. No index is needed for either,
which is what keeps it true when somebody copies a file in by hand.

**One sidecar per file**, `<id>.meta.json` — the suffix rather than a swapped
extension, because `files/` may itself hold a `.json` and a sidecar that could
be mistaken for an upload gets listed as one. Every field on it is optional and
every field is what somebody said; a test asserts the server writes no
`caption` and no `description` of its own.

**The routes.** `POST /api/v1/<user>/inbox` (multipart, positional `meta` and
`kind` alongside `files`), `GET /api/v1/<user>/inbox`, and `DELETE
/api/v1/<user>/inbox/<id>`. All three are journal-scope only: the bucket
belongs to the journal, and showing it to a trip-scoped token would show files
staged for trips that person is not on. The refusal names the trip's own media
route instead.

**Filing into a day is the media route's third door, not a fourth verb here** —
the one change from the capture, which had imagined `inbox:<id>` as a gallery
item on a day write. Days do not take a gallery on write at all: photographs
reach an entry through `attachGallery`, which the media route already calls.
So `POST .../trips/<trip>/media` now accepts `{"day": …, "inbox": [ids]}`
beside `files` and `urls`, and gets decode, resize, metadata-stripping,
original-keeping and attachment for free rather than growing a second set of
rules for what a gallery item may be. It **moves**: the file leaves the inbox
once it is in the trip, and the deletion happens after the store, so a batch
that fails to write cannot delete somebody's only copy.

**Orienting.** `GET /api/v1/<user>/status` carries `inbox: {count, bytes,
url}`, and `next` says to look at it when files are staged and no drafts are
waiting — an agent that does not know the bucket has anything in it writes a
day without its photographs. `/agent.md` gains the workflow as its own section
before the photographs one, including that which day a picture belongs to is
still not an agent's decision.

**B661's guard, from this door too** — the inbox is inside the ceiling and must
not be the way round it.

**Not doing:** nothing reads `files/` yet. No bank-statement parsing, no CSV
into costs, no AI description of a scan. The folder and the sidecar format
exist so those arrive somewhere sensible when they are built.

## Acceptance

`test/inbox.test.ts` (20) and `test/inbox-route.test.ts` (5).
`npm run verify` passes: 312 files, 4080 tests.

- **Staging with no day.** "the round trip: stage, write the day, file it,
  bucket empty" asserts the day does not exist when the file is staged, then
  writes it, files the photograph, and finds it in the trip's `media/`, in the
  entry's `gallery:`, and gone from the inbox.
- **Duplicates.** "the same bytes under the same name are stored once" — one
  file on disk, the same id, and the journal's byte total unchanged. "two
  different files sharing a name both survive". "a duplicate does not
  overwrite what was said the first time".
- **All or nothing.** "an id that names nothing refuses the whole call and
  moves nothing" — 400 `unknown_inbox_file`, the good file still staged, no
  media directory created for the day.
- **The ceiling.** B661's `storageRefusal` runs before anything is written;
  the refusal is the same sentence uploads get.
- **Not reachable by URL.** `resolveMediaFile` resolves under `tripMediaDir`
  only, so this holds by construction; "an id cannot climb out of the inbox"
  covers the other direction — `../../config.json` neither resolves nor
  deletes.
- **Nothing invented.** "carries what was said, and nothing else" asserts a
  sidecar has no `caption` and no `lon` when nobody supplied them.
- **The contract.** Both routes and the media route's new `inbox` field are in
  `lib/api/openapi.ts`; `test/openapi-contract.test.ts` passes.

**For whoever verifies this:** the thing to try is the order of work — stage a
few photographs against a trip whose days are not written, `GET
/api/v1/<user>/status` and check `next` points at the inbox, then write a day
and file them. The failure worth looking for is a file that is in the day
*and* still in the inbox.
