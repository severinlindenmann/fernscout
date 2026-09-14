---
id: B1726
title: Every page downloads two font files it never uses, and warns about it
type: ISSUE
priority: medium
complexity: low
area: layout, fonts
found: "2026-09-14T10:47:36Z"
---

# B1726 — Every page downloads two font files it never uses, and warns about it

## Why

Chrome prints this on every page of fernscout.ch, three times:

> The resource https://fernscout.ch/_next/static/media/…woff2 was preloaded
> using link preload but not used within a few seconds from the window's load
> event.

It is not a false alarm. B1044 split each display family in two — `Fredoka`
(`subsets: ["latin"]`, preloaded) and `fredokaExt` (`subsets: ["latin-ext"]`,
`preload: false`) — to keep the Hungarian glyphs available without preloading
them. What next/font actually emits for the second call is the **latin** face
again, byte-identical, pointing at the non-preloaded copy of the same file.
The shipped stylesheet holds both, and the later rule wins:

```
Fredoka           | 5d52bd6c4cb3f315-s.p.<hash>.woff2   <- preloaded
Fredoka           | 5d52bd6c4cb3f315-s.<hash>.woff2     <- what the page uses
Plus Jakarta Sans | fba5a26ea33df6a3-s.p.<hash>.woff2   <- preloaded
Plus Jakarta Sans | fba5a26ea33df6a3-s.<hash>.woff2     <- what the page uses
IBM Plex Mono     | 99e609270109b47d-s.p.<hash>.woff2   <- preloaded
```

So every cold load fetches Fredoka latin and Jakarta latin twice and renders
with the copy the preload did not buy. The preload is dead weight, not a
tuning knob: B1044's stated gain never arrived.

IBM Plex Mono has no duplicate, but the landing page paints no mono text
within Chrome's window, so its preload warns too.

## Work

Drop `preload` on the three preloaded families in `app/layout.tsx`. The faces
still ship in the render-blocking stylesheet linked from the document head, so
discovery is essentially unchanged, `font-display: swap` covers the rest, and
two wasted downloads per cold load go away. Correct B1044's comments rather
than leaving them asserting a split that does not do what they say.

Do not merge the subsets back together — latin-ext must stay declared and
unpreloaded, which is the half of B1044 that does work.

## Acceptance

- A cold load of `/` and of a trip page fetches each woff2 once; no
  `-s.p.` file is requested.
- No "preloaded ... but not used" warning in the console at desktop and phone
  width.
- Hungarian prose still renders in Fredoka/Jakarta, not a fallback.
