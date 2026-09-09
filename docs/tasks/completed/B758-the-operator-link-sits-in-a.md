---
id: B758
title: The operator link sits in a section of its own rather than in the header
type: CHORE
priority: medium
complexity: low
area: landing, ops
found: "2026-09-07T16:00:00Z"
merged: "2026-09-07T13:55:43Z"
completed: "2026-09-09T16:47:42Z"
---

# B758 — The operator link sits in a section of its own rather than in the header

## Why

B755 put the way into `/admin` on the landing page as a titled block between
the agent instruction and the device list — a heading, a sentence of
explanation and an arrow link, the same weight as "Your agent" and "Your
devices".

That is too much furniture for what it is. Those two blocks are things the
signed-in reader is meant to *do*; this is a door for one person on the whole
instance, and giving it a section implies it is part of the page's argument.
Worse, it repeats a mistake this page already corrected once: B426's note in
`components/LandingSections.tsx` records the reader's way in being placed
"next to the language switcher, in the same weight as the language switcher" —
a small word in the corner is the established shape here for a link that only
some readers want.

## Work

Move it into `SiteHeader` beside `LocaleSwitcher`, drawn at the same weight —
the `subtle` treatment `LocaleSwitcher` already uses in this position
(transparent border, `text-navy-600`, fill on hover, `min-h-11` for the hit
area). Drop the section, the heading and the body sentence; `home.operatorBody`
becomes unused and goes with them.

`SiteHeader` takes an `admin` prop. It stays a client-side decision arriving
from `/api/v1/me/home`, not a server render: `/` is the same cacheable document
for everybody (B412), and the header is rendered in both the signed-in and
signed-out branches from one `const`, so the prop has to tolerate `undefined`.

## Acceptance

- Signed in as `FERNSCOUT_ADMIN_EMAIL`, the header shows the operator link
  beside the language switcher, and no section appears further down.
- Signed in as anybody else, and signed out, the header is unchanged.
- `home.operatorBody` is gone from all three locale files and from
  `lib/i18n.ts`.
- `npm run verify` passes.
