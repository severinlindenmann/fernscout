---
id: B287
title: The contacts page carries addresses and now invite links, and nothing in the repo pins its cache headers
type: SECURITY
priority: medium
complexity: low
area: contacts, headers, privacy
found: "2026-09-04T13:05:00Z"
---

# B287 — The contacts page carries addresses and now invite links, and nothing in the repo pins its cache headers

## Why

Found while building B280, and captured rather than absorbed because it is
older than that task and wider than it.

`/<user>/contacts` renders the most sensitive page this software has. It has
carried decrypted postal addresses since C14 — `app/[user]/contacts/page.tsx:62`
says so in as many words, "decrypted here and nowhere else on the public side" —
and after B280 it also carries live invite URLs, each of which is a credential
somebody can redeem.

What the repository pins for that page: `export const dynamic = "force-dynamic"`
(`app/[user]/contacts/page.tsx:15`) and `robots: { index: false, follow: false }`
(line 17). What it does not pin anywhere is `Cache-Control`. The header block in
`next.config.ts:156` sets CSP, `Referrer-Policy`, `X-Content-Type-Options`,
`X-Frame-Options` and HSTS for `/:path*` — no caching directive. The only
`Cache-Control: no-store` in the codebase is `proxy.ts:92`, on the 410
tombstone.

Next's own default for a dynamic route is `private, no-cache, no-store,
max-age=0, must-revalidate`, so this is very likely already correct in practice
— **and that is the finding**: it is correct by a framework default that nothing
here asserts, on the one page where being wrong means a shared laptop's back
button, a corporate middlebox or a browser cache holding fifty people's home
addresses and a working invite link. A default nobody has written down is a
default nobody notices changing.

## Work

1. **Confirm what is actually sent**, against the deployed instance rather than
   a dev server: `curl -sI https://fernscout.ch/<user>/contacts` with an owner
   cookie, and the same for `/<user>/me`, which carries a handover credential
   after B283. Record the real headers in this task — that is half the value of
   it.
2. If they are already `no-store`, **pin it anyway** so a Next upgrade cannot
   quietly change it: a `headers()` entry for `/:user/contacts` and `/:user/me`
   in `next.config.ts`, beside the CSP block that is already per-path, plus a
   test asserting it the way the CSP is asserted.
3. If they are not, that is the fix.

Consider `Referrer-Policy: no-referrer` for these two paths specifically. The
baseline is `strict-origin-when-cross-origin`, which is right for a trip URL —
the comment at `next.config.ts:163` explains why — but the origin alone is
still more than a page holding credentials needs to leak.

Not doing: `Clear-Site-Data`, or anything about the *client* copy of the invite
URL once the owner has pasted it somewhere. Where a credential goes after the
owner copies it is theirs, and B280 and B283 both say so in their own text.

## Acceptance

- The real response headers for `/<user>/contacts` and `/<user>/me` are written
  down in this task, taken from the live instance.
- Both paths answer with `Cache-Control` containing `no-store`, set by this
  repository rather than inherited, and a test asserts it.
- The four checks pass.
