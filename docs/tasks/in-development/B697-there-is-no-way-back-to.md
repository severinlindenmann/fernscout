---
id: B697
title: There is no way back to the site from /agent
type: ISSUE
priority: low
complexity: low
area: agent, ui
found: "2026-09-07T10:35:46Z"
started: "2026-09-07T11:40:39Z"
session: 97b44327-dee7-4b48-bf97-305a0b3d1f54
claimed: "2026-09-07T11:40:39Z"
---

# B697 — There is no way back to the site from /agent

## Why

`/agent` (B681) renders its own `<main>` and nothing else: no site header, no
mark, no link home. Every other page here carries `components/PageHeader.tsx`.
A person who arrives from a link — which after B694 is most of them — has no
way back to the journal or the landing page except the browser's back button,
and on an installed PWA there is not always one of those.

It also means the page does not say which instance it belongs to beyond the
title, which matters on a self-hosted server whose name is the point.

## Work

Give `/agent` the same chrome as the rest of the site, or say in a comment why
it deliberately has none. Check it at 390px, where a header costs vertical
space that the sign-in card wants.

## Acceptance

From `/agent`, one tap reaches the site it belongs to, on a phone.
