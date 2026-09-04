---
id: B360
title: The invite landing page offers a postcard on a server with postcards switched off
type: ISSUE
priority: medium
complexity: low
area: contacts
found: "2026-09-04T19:57:29Z"
started: "2026-09-04T21:05:05Z"
session: 62683d95-33a6-4db0-a254-7a8fcbcf014e
claimed: "2026-09-04T21:05:05Z"
---

# B360 — The invite landing page offers a postcard on a server with postcards switched off

## Why

`/api/health` on this instance reports
`postcards: {"enabled": false, "reason": "not enabled on this server"}`.

The invite landing page — both kinds — devotes its largest block to a postal
address, headed "only if you'd like a real postcard in the mail", with six
fields and a "Send me a real postcard from the road" checkbox.

Observed 2026-09-04 on fernscout.ch. It is the biggest thing on the form, and
the server cannot do it.

AGENTS.md: "Every optional capability is off by default and must be *absent*
rather than broken when disabled." A reader asked for their street address and
told a postcard may follow, on a server with no postcard provider configured,
is the broken-rather-than-absent case — and it is a home address collected for
nothing.

Note the phone field one row up gets this right: "kept on file for the owner —
nothing on this site sends to it yet" (B303).

## Work

Hide the postal block and its checkbox when `postcards` is off, the way
`lib/capabilities.ts` gates everything else. Rows already holding an address
are untouched.

## Acceptance

With postcards disabled, neither invite landing page asks for a postal address.
With it enabled, both do.
