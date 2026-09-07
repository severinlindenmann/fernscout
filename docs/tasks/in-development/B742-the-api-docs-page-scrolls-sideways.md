---
id: B742
title: The API docs page scrolls sideways on a phone
type: ISSUE
priority: low
complexity: low
area: docs, mobile
found: "2026-09-07T12:45:21Z"
started: "2026-09-07T12:53:39Z"
session: ccdd5120-0eb0-4abf-b76e-a6fd8e5005d8
claimed: "2026-09-07T12:53:39Z"
---

# B742 — The API docs page scrolls sideways on a phone

## Why

At a 390px viewport, `/docs/api` reported `document.documentElement.scrollWidth
=== 428`, and the page scrolled sideways. Not caused by the `--font-mono`
token from B733 — measured 428 both with IBM Plex Mono applied and with the
token neutralised.

Measured with an isolated Chromium (`playwright-core`), walking
`[...document.querySelectorAll('*')].filter(e =>
e.getBoundingClientRect().right > 391)` from the widest element down: the
`<li>` items in the endpoint index — `app/docs/api/page.tsx`, the `<ul
className="grid gap-1 font-mono text-sm text-navy-700 sm:grid-cols-2">` inside
`<nav aria-label="Endpoints">` — each measured `right: 427.8`, matching the
page's `scrollWidth` almost exactly. It is a CSS grid, so each `<li>` is a
grid item with the browser default `min-width: auto`, which refuses to shrink
below its content's min-content width; a route path such as
`/api/v1/{user}/trips/{trip}/days/{slug}/send-whatsapp` (55 chars, unbroken —
no spaces) is wider than the grid track wants to be, so the whole grid — and
the page — is stretched to fit it. Same family of bug as the `min-w-0` on
`<body>` in `app/layout.tsx` (its own comment names the precedent, an id with
no surviving task file), one level down: a flex/grid item's default min-width
refusing to shrink below an unbreakable string.

(A closed-by-default `<code>` inside one endpoint's collapsed `<details>`
description also reported a wide `getBoundingClientRect`, but
`checkVisibility()` is `false` for it and it is not what drives `scrollWidth`
— the `<li>` grid items above account for the actual 428.)

## Work

`app/docs/api/page.tsx`: added `min-w-0` to the `<li>` (so the grid item can
shrink) and `break-all` to the `<a>` inside it (so the long path wraps onto a
second line instead of overflowing). Nothing else touched — no restyle, no
change to what the page lists, the mono font untouched.

Checked every other `/docs/*` route at 390×844 for the same fault before and
after the fix (all were already at 390, i.e. this was the only offender):

| Page | scrollWidth |
| --- | --- |
| `/docs` | 390 |
| `/docs/api` | 428 → **390** (fixed) |
| `/docs/branding` | 390 |
| `/docs/branding/identity` | 390 |
| `/docs/branding/animation` | 390 |
| `/docs/branding/print` | 390 |
| `/docs/branding/travellers` | 390 |
| `/docs/branding/day` | 390 |
| `/docs/contributing` | 390 |
| `/docs/hosting` | 390 |
| `/docs/helper` | 390 |
| `/docs/guide/guest` | 390 |
| `/docs/guide/creator` | 390 |
| `/docs/guide/buddy` | 390 |

Screenshotted `/docs/api` after the fix: the endpoint index renders one path
per line, long ones wrap onto a second line and stay fully readable — not
squashed or truncated.

## Acceptance

`document.documentElement.scrollWidth === document.documentElement.clientWidth`
(no horizontal scroll) at 390×844 on `/docs/api`. Verified above: 390 === 390.
`npm run verify` passes.
