---
id: B1559
title: Paid send routes rely on SameSite=lax alone — no Origin check as second layer
type: SECURITY
priority: low
complexity: low
area: postcards/photobook
found: "2026-09-11T23:06:54Z"
started: "2026-09-12T07:22:52Z"
session: 5c987a64-dfc0-4ac9-9b57-3804213ba1b8
claimed: "2026-09-12T07:22:52Z"
---

# B1559 — Paid send routes rely on SameSite=lax alone — no Origin check as second layer

## Why

The two routes that spend credits at a printer —
`app/[user]/postcards/[id]/send/route.ts` and
`app/[user]/photobook/order/route.ts` — authenticate purely from the owner's
cookie with no Origin/Referer check or CSRF token. Protection rests entirely
on `sameSite: "lax"` (`app/api/auth/verify/route.ts:116`,
`lib/auth/identityCookie.ts:56`), which does block cross-site form POSTs in
modern browsers, so this is not exploitable today. But it is single-layered:
a future same-site subdomain hosting user content, or one cookie set without
the attribute, silently removes the only barrier in front of a one-click
money spend.

## Work

Refuse the two paid POST routes when the `Origin` header is present and does
not match the instance's own origin — a few lines of defence in depth.
Consider the trip-delete route for the same check.

## Acceptance

A POST to the send route with a foreign `Origin` and a valid cookie is
refused; the real send flow from the site's own pages still works.
