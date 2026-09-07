---
id: B697
title: There is no way back to the site from /agent
type: ISSUE
priority: low
complexity: low
area: agent, ui
found: "2026-09-07T10:35:46Z"
started: "2026-09-07T11:40:39Z"
merged: "2026-09-07T12:17:55Z"
completed: "2026-09-07T13:14:02Z"
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

## Resolution

Added `app/agent/layout.tsx`, a thin frame wrapping both `/agent` (the door)
and `/agent/[user]` (the wizard) — the full `components/PageHeader.tsx` was
not a fit: it is journal-scoped (`TripSwitcher`, currency, trip context all
assume a trip is already in play, which is never true on the door and only
sometimes true mid-wizard). Instead the new layout borrows the same shape
`app/docs/layout.tsx` already uses for the identical reason (a page that
belongs to the instance rather than to one trip): a link back to `/` and the
instance's own name, using the existing `docs.backToSite` translation key
(already generic — "Back to {name}" — and already translated in en/de/hu). No
locale switcher: unlike `/docs`, `LocaleProvider` here already comes from the
root layout, and a page mid-wizard is not the moment for a language switch.

Test: `test/agent-shell.test.ts`, in the style of `test/docs-shell.test.tsx`
(the docs-shell test for the same complaint, B470) — asserts the layout file
exists and contains the back link and translation key. Confirmed it fails
before the layout existed and passes after.
