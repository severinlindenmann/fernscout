---
id: B1123
title: The files pane shows what you chose rather than what is waiting, and has no thumbnails
type: FEATURE
priority: high
complexity: high
area: lib/inbox.ts, app/[user]/inbox
found: "2026-09-09T17:45:59Z"
merged: "2026-09-09T19:07:21Z"
---

# B1123 — The files pane shows what you chose rather than what is waiting, and has no thumbnails

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

The pane says "Keine Fotos gewählt" and offers a picker: it shows what you have
*chosen*, which you already know, and hides what is *waiting*, which you do
not. There are no thumbnails, so a photograph is indistinguishable from another
photograph.

On a phone "attach" almost always means a picture taken twenty minutes ago, and
there is no way to reach the camera at all.

## Work

Turn it around: the whole inbox, newest first, grouped by kind. Photographs as
small thumbnails, a bank statement or a GPX as a labelled icon row with its
size and date. A count on the collapsed rail so "three things are waiting"
survives the panel being shut.

A paperclip in the composer, and drag-and-drop anywhere onto the conversation.
On a phone the same control opens a sheet leading with Camera and Photos, with
the inbox below it.

Ticking is unchanged: the tools already read `inbox:<id>` and
`photo:<slug>:<src>`, so this is a view over a mechanism that exists.

**The security surface, which is the whole risk in this ticket.** Nothing in
`inbox/` is reachable by URL today, deliberately — the files are named by a
hash of their own bytes and no route serves them. A thumbnail needs a route
that does. It must be owner-only, must resolve the id through `lib/inbox.ts`
rather than joining a path, and must refuse anything outside that journal's own
inbox. Run `claude-security` on the diff before merging; a path-traversal here
reads somebody's files.

Not doing: editing, rotating or deleting from the pane. `discard_file` exists.

## Acceptance

The pane lists every staged file newest first with a thumbnail or a typed
icon. A second journal's owner gets 404 from the thumbnail route for a real id
belonging to the first. `npm run verify` green, and a security pass on the new
route with its findings captured.
