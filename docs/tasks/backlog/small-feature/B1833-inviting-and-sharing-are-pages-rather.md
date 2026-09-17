---
id: B1833
title: Inviting and sharing are pages rather than flows
type: FEATURE
priority: medium
complexity: medium
area: studio, readers, contacts
found: "2026-09-17T05:11:56Z"
---

# B1833 — Inviting and sharing are pages rather than flows

## Why

`/[user]/contacts` (`ContactsAdmin`) manages invites and relationships, and the
trip page carries visibility. Both work. Neither is listed anywhere as
something a person can set out to do, and neither explains what the reader will
actually end up seeing — which is the question two testers asked and nobody had
put on a page (B877).

Sharing is also where the costly mistakes live. B923 and B931 are both a
visibility choice going the wrong way. A flow that previews *what this person
will see* before the invite goes out is the remedy.

Plan: `docs/plans/2026-09-17-the-studio.md`.

## Work

Two studio flows (B1829), sharing most of their shape:

**Invite somebody to read** — who, what they get to see, preview of exactly
that, then send. The copy must be truthful about the two-step reality: an
invite creates a request, not access, and nobody becomes a reader until they
confirm their own address.

**Who may read this trip** — the visibility choice, with the three options
worded only by their canned labels, and a preview of what each audience sees.
Never worded by the page's own prose.

Reuse `ContactsAdmin` and the existing invite machinery rather than
reimplementing; this is a way in and a preview, not a new permissions model.

Relates to B1823, which brings the people in from a vCard — that is *who was
there*, this is *who may read it*. Keep them distinct in the hub; conflating
them is how somebody accidentally grants reading rights to an address book.

## Acceptance

- Both flows are reachable from the studio and state what the other person will
  see before anything is sent.
- The invite flow never implies access has been granted when only a request has
  been created.
- Visibility options are worded by their canned labels only.
- Real en/de/hu strings; `npm run i18n:keys` clean.
- Verified in a real browser at desktop and phone width, checked as owner and as
  the invited reader.
- `npm run verify` passes.
