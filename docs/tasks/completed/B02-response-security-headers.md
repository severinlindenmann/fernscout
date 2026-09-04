---
id: B02
title: No security headers on any response, and SVG is still served inline
type: SECURITY
priority: medium
complexity: low
area: headers, media
found: "2026-09-01"
started: "2026-09-04T06:50:26Z"
merged: "2026-09-04T07:42:55Z"
completed: "2026-09-04T21:54:15Z"
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

Done, and enforcing rather than report-only — nothing on the site needed
loosening, so a report-only phase would have been a policy nobody ever
promoted.

1. A `headers()` block in `next.config.ts`, on `/:path*`, so pages, API routes
   and the `.md` twins all carry it: the CSP, `Referrer-Policy`,
   `X-Content-Type-Options`, `X-Frame-Options: DENY` and HSTS.
2. A second, later rule on `/:user/media/:path*` with
   `default-src 'none'; sandbox`. Later on purpose — Next applies every
   matching rule in order and the last to set a key wins, so ordering is what
   gives a media file its own policy instead of the document one. The route
   handler sets the same header itself as well, so the guarantee does not
   depend on a path pattern staying in step with the route tree.
3. HSTS in `next.config.ts` rather than in `deploy/Caddyfile`. The Caddyfile is
   a reference snippet a self-hoster may merge, replace or never use, and a
   security header that exists only in one deployment's proxy config is a
   header this software does not have. A comment in the Caddyfile says so and
   warns against adding a `header` directive that would replace it.

**`preload` is deliberately absent** from the HSTS value. It is a commitment
other people's browsers keep for years on a domain this project does not own,
and it cannot be withdrawn quickly.

**`script-src` keeps `'unsafe-inline'`, and the file says why.** Next inlines
its flight payload; removing it means a per-request nonce, which means proxy
middleware and dynamic rendering on every page — Next's own guide is explicit
that this disables static generation. That is a real trade against a threat
this codebase does not have (no `rehype-raw`, no upload path that lands
markup). What the policy still buys is the *next* step of an XSS: no script
from another origin, no `<object>`, no rewritten `<base>`, no form posting
off-site, no exfiltration over `connect-src`.

### The SVG half, as built

`Content-Security-Policy: default-src 'none'; sandbox` on every media response
— `sandbox` drops the file into an opaque origin, so it is no longer same-site
with the guest cookie even when navigated to directly — plus
`Content-Disposition: attachment` on `image/svg+xml` specifically. Neither
affects an `<img>`, so the example content's placeholders still render; both
only bite when a browser treats the file as a document, which is the only way
an SVG's script ever runs.

## Acceptance

**`curl -I` against a running dev server** (`next dev`, port 3711):

```
$ curl -sSI http://localhost:3711/example
HTTP/1.1 200 OK
Content-Security-Policy: default-src 'self'; base-uri 'self'; object-src 'none';
  frame-ancestors 'none'; frame-src 'none'; form-action 'self';
  script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline';
  img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self' data:;
  connect-src 'self' ws:; worker-src 'self'; manifest-src 'self'
Referrer-Policy: strict-origin-when-cross-origin
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Strict-Transport-Security: max-age=63072000; includeSubDomains
```

(`'unsafe-eval'` and `ws:` are the dev-only halves — React's refresh runtime
uses `eval`, and HMR uses a websocket. A production build carries neither, and
adds `upgrade-insecure-requests`.)

`/api/health` returns the same five headers. And the media route:

```
$ curl -sSI '.../example/media/asia-2023/bangkok-first-morning/probe.svg'
HTTP/1.1 200 OK
Content-Security-Policy: default-src 'none'; sandbox
content-disposition: attachment
content-type: image/svg+xml
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
X-Frame-Options: DENY
Strict-Transport-Security: max-age=63072000; includeSubDomains

$ curl -sSI '.../example/media/asia-2023/bangkok-first-morning/01.jpg'
Content-Security-Policy: default-src 'none'; sandbox
content-type: image/jpeg
X-Content-Type-Options: nosniff
```

One CSP header, not two: the ordering override works, and a photograph is not
offered as a download.

**No CSP violations in the console**, driven through a real browser against the
same server — `/`, `/example`, the story (`/example/trips/asia-2023`), the map,
`/costs`, the gallery slideshow and a day page. Zero errors on every one; the
only warnings are pre-existing `next/image` LCP advice.

**Tests**: `test/security-headers.test.ts`, six cases — the baseline values,
that `script-src` names no other origin, that the media rule is declared after
the baseline so it wins, and that the route's own response sandboxes an SVG and
hands it over as an attachment while leaving a JPEG alone. All six fail against
the code as it stood.
