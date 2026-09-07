---
id: B674
title: There is no way to post from a phone without a browser
type: FEATURE
priority: low
complexity: high
area: mobile, media, gps
found: "2026-09-07T08:56:15Z"
---

# B674 — There is no way to post from a phone without a browser

## Why

The phone is where the photographs are and where the traveller is, and the
only door it has is a browser. That is enough to read and — with an agent on
the other end — enough to write, but it is not enough for the two things a
phone is uniquely good at: handing over a full-resolution photograph the
moment it is taken, and carrying position (B665, B666, and the `gps/` folder
that already exists for exactly this).

Uploading forty photographs from a phone browser over a hotel connection is
the case that fails today, and it fails in the least recoverable way — halfway
through, with no resume.

There is no editing interface and there will not be one (decision 24), so this
is not a CMS in an app wrapper. What an app can be is a *client of the API
that already exists*: a token in the keychain, files to `POST`, positions to
`gps/`, and everything editorial still happening through an agent.

## Work

Almost certainly not the first thing to build, and the file should say why
before anybody starts. Order the cheap options first and take one:

1. **A PWA.** Installable, camera access, background upload with a service
   worker. Costs no store account, no review, no second language, and works on
   both platforms. This is the lazy answer and it is probably the right one.
2. **A Shortcut / share-sheet target** driving `/api/v1/…` with a handover
   token (B283). No app at all, and it covers "send this photo to my journal"
   entirely.
3. **A native app**, only if 1 and 2 are shown to be insufficient — background
   location and reliable large uploads are the honest arguments for it.

Whatever is built holds an agent token, and therefore has to answer where the
token comes from (`POST /api/auth/handover` is the mechanism), where it is
kept, and how it is revoked from `/<user>/contacts`. It writes drafts, like
every other agent; it does not publish.

Not doing: an editing UI, offline conflict resolution, or an Android app in
the same ticket.

## Acceptance

The deliverable of the *first* pass is a decision written into this file, with
what each option cannot do. Then, for whatever is chosen: a photograph taken on
a phone reaches a day as a draft, over the public API, with a token the app
obtained through handover and can lose without anything else being lost.
