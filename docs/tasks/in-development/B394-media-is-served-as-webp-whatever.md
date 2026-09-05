---
id: B394
title: Media is served as WebP whatever the client says it accepts, and Vary does not mention Accept
type: ISSUE
priority: low
complexity: low
area: media
found: "2026-09-04T22:39:23Z"
started: "2026-09-05T07:11:49Z"
session: 62683d95-33a6-4db0-a254-7a8fcbcf014e
claimed: "2026-09-05T07:11:49Z"
---

# B394 — Media is served as WebP whatever the client says it accepts, and Vary does not mention Accept

## Why

Derivatives are served from a `.jpg` URL as `image/webp`, and the request's
`Accept` header makes no difference. Measured in the browser on fernscout.ch
(f5561fe), same URL, two fetches:

```
Accept: image/webp,image/avif,image/*  -> 200 image/webp
Accept: image/jpeg                     -> 200 image/webp
```

A client that has said it takes JPEG and not WebP is sent WebP anyway. The
response's `Vary` lists only the Next.js router headers -- not `Accept` -- so a
shared cache has no way to key the two apart either, which is the half that
would bite later if negotiation is ever added.

In practice WebP is near-universal, so this is not breaking anyone today. It is
filed because the URL, the header and the bytes currently disagree, and because
`Vary` is the kind of omission that is cheap now and expensive after a CDN.

**Relevant to B08**, which asked for WebP "alongside JPEG with `<picture>`".
The delivery goal was met by a different and arguably better route -- always
serve WebP -- and there is no `<picture>` element on the page. Worth deciding
whether B08 is satisfied by this or whether the JPEG fallback it names is still
wanted; that decision is a person's, not this ticket's.

## Work

Either honour `Accept` and fall back to JPEG when WebP is not offered, or keep
serving WebP unconditionally and add `Vary: Accept` so caches stay correct.

## Acceptance

A request sending `Accept: image/jpeg` either receives JPEG, or the response
carries `Vary: Accept`.
