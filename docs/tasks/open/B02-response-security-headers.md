---
id: B02
title: No security headers on any response, and SVG is still served inline
type: SECURITY
priority: medium
complexity: low
area: headers, media
found: "2026-09-01"
---

# B02 — No security headers, and SVG served inline

## Why

Neither `next.config.ts` nor `deploy/Caddyfile` sets `Content-Security-Policy`,
`X-Frame-Options` / `frame-ancestors`, `Referrer-Policy` or
`Strict-Transport-Security`. The only CSP in the repo is scoped to `next/image`
and exists to contain SVGs it optimises.

Nothing is exploitable today. There is one `dangerouslySetInnerHTML`
(`components/StructuredData.tsx:11`, JSON-LD) and no raw-HTML markdown plugin —
`react-markdown` runs without `rehype-raw`, so entry prose cannot inject
elements. This is defence in depth, and two things make it worth having:

- **The pages are framable.** `/<user>/join`, `/<user>/me` and the
  trip-password form all take input and all sit on the origin holding the
  session cookie.
- **There is no second layer.** The day an XSS does appear — a new component, a
  dependency, a future upload path — a CSP is the difference between a bug and
  a session compromise.

## The SVG half

`lib/media.ts:104` maps `.svg` to `image/svg+xml`, and
`app/[user]/media/[...path]/route.ts` serves it inline with that content type.
An SVG is a script-bearing document, and `X-Content-Type-Options: nosniff` does
not help against a type the server itself declared.

**Not currently reachable by an attacker.** Uploads cannot produce one:
`lib/validate/media.ts:92` allowlists jpeg, png, heic, heif and webp, and
derivatives are re-encoded through sharp. The only SVGs on disk are the
generated placeholders in the example content, put there by the owner — which
is why `dangerouslyAllowSVG` is on in the first place.

So this is a latent footgun, not a live hole: any future path that lets a
non-owner place a file turns it into stored XSS on the session origin. A CSP on
the media response closes it without giving up the placeholders.

## Work

1. A `headers()` block in `next.config.ts`: `frame-ancestors 'none'`,
   `Referrer-Policy: strict-origin-when-cross-origin`, and a CSP for the
   document routes. Start in report-only if that is more comfortable — the
   procedural skylines and the travel animation are the parts most likely to
   want `style-src` attention.
2. A tighter, separate CSP on the media route —
   `default-src 'none'; sandbox` — which neutralises an SVG whatever else
   changes.
3. HSTS. Caddy manages the certificate but the header is not in the config;
   set it explicitly rather than assuming.

## Acceptance

- `curl -I` on a page, an API route and a media file shows the headers.
- The story, the map, `/costs` and the slideshow render with no CSP violations
  in the console.
