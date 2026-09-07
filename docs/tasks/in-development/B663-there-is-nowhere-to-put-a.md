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

**A bucket per journal, called `inbox/`.** `content/<username>/inbox/`, with
four subfolders, because what a file is *for* decides what happens to it next
and a flat folder makes an agent guess:

```
content/<username>/inbox/
  media/       photographs and video, destined for a day's gallery
  files/       csv, pdf, json — read, not published (see "later" below)
  photobook/   artwork and inserts for a printed book
  postcards/   the same for a card
```

It is inside the journal folder on purpose: it is the owner's content, it is
in their backup and their export, and — since B661 counts the whole folder —
it is already inside the storage ceiling with nothing further to write.

**A name that is the content, so a duplicate cannot collide or accumulate.**
`<sha256[0..12]>-<safe-name>.<ext>`. Two files with the same name and different
bytes get different prefixes and both survive; the *same* bytes uploaded twice
resolve to the same name, so the second upload is a no-op that returns the
first one's id. That is the whole duplicate story, and it needs no index to be
true — it is a property of the filename.

**One sidecar per file, not one manifest.** `a3f1c2-sunset.jpg` beside
`a3f1c2-sunset.json`. A file and its facts are moved, copied and deleted
together, and two agents uploading at once never write the same file — a
single `index.json` would be a lock nobody has and a half-written manifest
that orphans everything in the folder. Listing costs a directory read, which
is what `lib/storageQuota.ts` already does to every one of these files anyway.

Every field on the sidecar is optional and every one of them is *what somebody
said*, never what the server guessed:

| | |
| --- | --- |
| `description` | what it is, in the uploader's words |
| `lat`, `lon` | where, if they said |
| `takenAt` | when, if they said |
| `caption` | the caption to carry into a gallery item |
| `tags` | free tags, for an agent to search on |
| `kind` | which subfolder it went to |
| `uploadedAt`, `bytes`, `sha256`, `filename` | measured, not claimed |

**Nothing here is inferred.** EXIF is read where it is already read
(`lib/ingest/image.ts` strips it), and a coordinate the file carried is a
measurement, not an invention — but a *description* is never written by
whatever uploaded the file. AGENTS.md's one rule applies in full: an empty
field beats a plausible fiction.

**The API.**

- `POST /api/v1/<user>/inbox` — bytes as multipart, or `urls` like the media
  route already takes, plus the optional metadata above. Answers with each
  file's id, name and sidecar.
- `GET /api/v1/<user>/inbox` — the whole structure: every subfolder, every
  file, its sidecar, its size. This is the call the ticket is really about —
  an agent asks it once and knows what it has to work with.
- `DELETE /api/v1/<user>/inbox/<id>` — file and sidecar together.
- **Referencing one when writing a day**: a gallery item may name
  `inbox:<id>` instead of carrying bytes. Writing the day *moves* the file out
  of `inbox/media/` and through the ordinary pipeline into the trip
  (`storeUploads`), so a day that has been written owns its photographs and
  the inbox shrinks. Draft or published makes no difference: it is the write
  that files it, not the publish.

**It goes through B661's guard.** `storageRefusal` before anything is written,
same as `storeUploads` — the inbox is inside the ceiling and must not be the
way round it.

**Nothing in `inbox/` is reachable by URL.** `resolveMediaFile` resolves under
`tripMediaDir` and nothing else, so this is true by construction today; a
preview for the owner is an authenticated route and must be written as one. A
file waiting to be filed is not published, and the person who uploaded it has
not decided anything yet.

**Not doing now** — the file kinds beyond media are accepted and stored, and
nothing reads them yet: no bank-statement parsing, no CSV into costs, no AI
description of a scan. `files/` exists so those have somewhere to arrive when
they are built, and so the format does not have to change when they are.

Contract: three routes into `lib/api/openapi.ts` with their refusals, the
sidecar's fields into a schema, and `/agent.md` gains the workflow — upload
first, list, then write days that reference what is there.

## Acceptance

- `POST` a file with no day and no trip; `GET /api/v1/<user>/inbox` lists it
  with its sidecar. Neither call names a day, which is the whole point.
- The same bytes uploaded twice leave one file on disk and return the same id.
  Two different files sharing a name both survive, with different ids.
- A day written with a gallery item of `inbox:<id>` ends with the photograph
  in the trip's `media/`, a derivative made, and nothing left in
  `inbox/media/` for that id.
- An upload that would take the journal past its ceiling is refused, and
  writes nothing — B661's guard, from this door too.
- A file in `inbox/` is not fetchable at any `/media/…` URL, signed in or not.
- A sidecar field nobody supplied is absent, not invented. A test asserts the
  server never writes `description`.
- `npm run verify` passes, and `/openapi.json` documents all three routes.
