---
id: B1656
title: The helper's photo-gallery and inbox writes hit B1650's same wall — v2 has no gallery-attach at all
type: FEATURE
priority: medium
complexity: high
area: Helper / API v2
found: "2026-09-13T10:03:26Z"
merged: "2026-09-13T14:28:08Z"
completed: "2026-09-14T16:32:31Z"
---

# B1656 — The helper's photo-gallery and inbox writes hit B1650's same wall — v2 has no gallery-attach at all

## Why

Step 5 of the v2 migration asked for the helper's `inbox` and `day` media
tools (`app/api/helper/[user]/inbox*`, `day/media`, `day/attach`,
`day/remove-photo`, `day/describe-photos`) to be repointed at v2 handlers,
deleting each v1 helper route as it goes — the same instruction B1650 was
given for day/trip. It cannot be done here either, and for a related but
worse reason: it is not only a completeness-contract mismatch, it is a
**missing capability**.

**Putting a photograph on a day's gallery has no v2 door at all.**
`storeMediaV2`/`storeTripPhoto` (`lib/api/v2/media.ts:60-118`) only ever
writes bytes to `media/<day>/<hash>.jpg` and a sidecar next to them. The
file's own doc comment says so outright (`lib/api/v2/media.ts:69-73`): *"this
never checks that a day of this slug actually exists: v2 days are their own
JSON documents, written through a different door... and this one only ever
decides where on disk the bytes go — a day references a photograph by `src`
afterwards, and that reference is the day route's business, not this one's."*
Nothing in `lib/api/v2/media.ts` touches `DayFile`, `dayFromJson`,
`dayToJson`, or a `media:` array — grepped and confirmed empty. The only
place that writes a photograph into a day's `media:` array is
`attachGallery`/`detachGallery` (`lib/api/entries.ts:744-919`), the same
functions v1's `POST/DELETE .../trips/<trip>/media` and every one of the
helper routes in this ticket's scope already call. There is no v2 route to
repoint to — `PATCH /api/v2/{user}/trips/{trip}/days/{slug}` is the only
thing that could conceivably do it, and that is B1650's wall: whole-document
validation against all 14 `DAY_DECLINABLES`.

**`attachGallery`/`detachGallery` also carry the same compare-and-swap gap
B1650 found in `unpublishEntry`.** Both call `fileUnchangedSince` before
writing (`lib/api/entries.ts:809`, `:903`) — a guard the v2 store has no
equivalent for, because a v2 *route* gets its safety from `If-Match`/ETag,
which a cookie-driven helper turn never sends.

**Inbox upload has a second, independent wall: `mediaIntent`
(`lib/api/v2/schemas/media.ts`) doesn't cover the inbox's own kind space.**
`INBOX_KINDS` (`lib/inbox.ts:66`) is `media, files, photobook, postcards,
location, contact` — six kinds. `MEDIA_KINDS` (the v2 schema) is `photo,
bank_export, gps_history, document` — four, and none of them is
`photobook`/`postcards`/`contact`. A photobook proof or a shared contact
staged for review has nowhere to land through the v2 media door at all. On
top of that, `mediaIntent` asks (or demands a decline for) `trip`, and for a
`photo` also `day` and `caption`, **per file, every time** — the current
`receiveInboxUpload` (`lib/inboxUpload.ts`) takes a whole batch in one
request with `kind` auto-detected from the extension and every question
optional. Forcing that through v2's shape would mean either the helper
invents a decline reason for every file in a forty-photo batch someone just
wants staged for later ("synthesising the declines... is the one thing an
agent may never do", AGENTS.md) or the batch upload UX stops existing.

**Everything that only touches `content/<user>/inbox/` already shares the
one implementation with v2, so there is nothing there to repoint.**
`GET/DELETE /api/v2/{user}/inbox*` and the helper's own
`DELETE .../inbox/[id]`, `POST .../inbox/discard` all call the same
`listInbox`/`findInboxFile`/`removeInboxFile` in `lib/inbox.ts` directly —
no second implementation exists to consolidate. `GET .../inbox/[id]/thumbnail`
has no v2 counterpart at all (v2 exposes no thumbnail derivative); it was
never duplicated, so there is nothing to delete. `day/media`'s `GET` (storage
headroom) reads `loadUserConfig`/`storageFor`, again already shared and
untouched by the v1/v2 split.

**`day/describe-photos` writes nothing** — it returns caption suggestions a
person keeps through the ordinary media `PATCH`. It has no v1 predecessor and
nothing to repoint to; it is unaffected by any of this.

Taken for now, matching B1650: **leave all eight helper routes in this
ticket's scope on the shared domain functions.** Nothing was deleted and
nothing was repointed.

## Work

A decision first, mirroring B1650's own three options, plus the extra one
this ticket's routes need:

- **(a)** Teach the wizard v2's full asked-or-declined shape for a media
  upload and a day write, batched sensibly, and add `photobook`/`postcards`/
  `contact` to `MEDIA_KINDS` (or keep them off v2 and explicitly scope v2
  media to `photo`/`bank_export`/`gps_history`/`document` only, forever).
- **(b)** Give v2 an incremental write mode for a day's `media:` array
  specifically (attach/detach without whole-document completeness), separate
  from B1650's day-fields decision since a gallery attach touches one array,
  not fourteen fields — the completeness argument is much weaker here. This
  is the one most likely to actually close this ticket without reopening
  B1650's argument.
- **(c)** Leave day/media, day/attach, day/remove-photo, and inbox as they
  are — they already target the unified storage (`lib/api/v2/documents.ts`
  and its writer/reader pair) through `lib/api/entries.ts` and `lib/inbox.ts`,
  and they carry guards (`fileUnchangedSince`, batch upload, six inbox kinds)
  the v2 store does not have yet.
- **(d)**, specific to inbox only: extend `MEDIA_KINDS` to cover
  `photobook`/`postcards`/`contact` and add a batch form to
  `POST /api/v2/{user}/media`, so inbox staging genuinely has one door — this
  is separable from (a)/(b)/(c) above and could land regardless of which of
  those is chosen for the gallery-attach question.

## Acceptance

The owner picks (a), (b), (c), or (c) for gallery-attach plus (d) for inbox,
as the permanent answer(s). If (b) or (d), each lands with a D row in
`06-contract-deltas.md` saying what changed and why.

A test pins whichever is chosen for gallery-attach: that the helper's
`attachGallery`/`detachGallery` calls and whatever v2 mechanism is chosen (if
any) produce byte-identical `media:` arrays for the same input, so the two
cannot drift apart while both exist.
