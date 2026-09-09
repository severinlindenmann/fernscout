---
id: B1059
title: A photograph sent over WhatsApp has nowhere to land, and arrives compressed when it does
type: FEATURE
priority: high
complexity: medium
area: whatsapp, media, inbox
found: "2026-09-09T07:11:43Z"
---

# B1059 — A photograph sent over WhatsApp has nowhere to land, and arrives compressed when it does

## Why

WhatsApp is where the photographs are, which is most of the argument for the
channel at all — B674 is the open ticket about a phone having no door but a
browser, and it lists a PWA, a Shortcut and a native app without considering
the messenger the pictures are already in.

Two facts have to be in the ticket before anybody starts, because they cut
opposite ways.

**A photograph sent as a photograph is not the photograph.** WhatsApp
re-encodes it — typically to around 1600px on the long edge and a heavily
compressed JPEG — and it arrives here at a fraction of the original. This
repository keeps a full-resolution original beside the web derivative
(`tripOriginalsDir`) precisely because a photobook plate wants ~2500×3500, and
`IMAGE_MAX_EDGE` is 8000. A journal filled through WhatsApp is a journal whose
photobook cannot be printed well, and nobody will discover that until they
order one.

The same file sent **as a document** arrives untouched. So the channel has a
right answer and it is one a person has to be told about, in words, at the
moment they send their first picture.

**The size limits do not match.** Meta caps inbound at 5 MB for an image,
16 MB for audio and video, 100 MB for a document. This instance allows 50 MB
images and 500 MB video (`lib/validate/media.ts`). Nothing breaks; the ceiling
is simply Meta's, and the guide should say so rather than repeating ours.

## Work

- Fetch the media by id from the Graph API and store it. `lib/inbox.ts` is
  where it belongs — `storeInboxFile` already hashes the bytes for its id, so
  the same photograph sent twice is one file, which matters when somebody
  forwards a batch.
- Carry what the message knows into the `InboxMeta` sidecar: the caption goes
  in `caption`, the timestamp in `takenAt`. Nothing else — a WhatsApp image has
  had its EXIF stripped, so there is no location to read and none must be
  guessed.
- Media ids from a webhook expire after seven days at Meta's end. Fetch on
  receipt, not on demand.
- Count the bytes against the journal's ceiling through `storageRefusal()`
  before writing, and say so plainly in the chat when it refuses.
- **Tell the person about documents-versus-photos once**, when it first
  matters, and never again. A line in the reply to their first picture, not a
  paragraph on every one.
- `attach_files` (`lib/helper/tools/areas/files.ts`) then already moves them
  onto a day. Nothing about that tool changes.

Not doing: video (decide separately — 16 MB inbound will not carry much of
one), or accepting a picture from a number that is not bound (B1058 refuses
first).

## Acceptance

A photograph sent to the number appears in the journal's inbox with its
caption, the same photograph sent twice appears once, a picture past the
storage ceiling is refused in a sentence a person understands, and the
full-resolution route is offered in words the first time.
