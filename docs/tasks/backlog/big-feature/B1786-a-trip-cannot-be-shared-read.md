---
id: B1786
title: A trip cannot be shared read-only without creating a guest account
type: FEATURE
priority: medium
complexity: high
area: trip sharing, authorisation, media access
found: "2026-09-15T07:58:30Z"
---

# B1786 — A trip cannot be shared read-only without creating a guest account

## Why

An owner cannot give somebody a read-only view of one trip without first
creating a guest account. They need a shareable permanent URL that works in an
incognito browser and may be forwarded, while keeping the access boundary to
that one trip. The trip may contain private pictures, so the link must not
silently turn into access to the owner’s other content or a general-purpose API
credential.

## Work

Let an owner create one active, high-entropy, unguessable perma-link for a
specific trip and revoke it later. Creating a replacement must preserve the
rule that there is only one active link for that trip.

The holder needs no Fernscout account or guest login. The shared experience is
read-only and covers the visual trip content: the trip itself, gallery,
private pictures, map, and visual summaries/analysis. It may be forwarded to
anyone else.

Scope every rendered page, asset and backing request to the link’s trip. Do
not use the link as bearer access to general API endpoints, other trips,
owner-only views, source/original media, or hidden routes. Design the
authorisation and media-serving paths so a guessed identifier, altered URL or
direct request cannot widen the grant.

## Acceptance

An owner can create and revoke a single share link for a trip. In a fresh
incognito browser, a person who has the link can open a complete read-only
view of that trip, including its visual information, gallery/private pictures,
map and visual summaries, without logging in; forwarding the same link works.

After revocation, the link no longer shows the trip. A person holding it cannot
read, enumerate or fetch another trip, owner content, original/private media
outside the rendered share experience, or any unrelated API data by changing
paths, identifiers or calling backing endpoints directly. Automated coverage
proves those boundaries as well as the intended shared view.
