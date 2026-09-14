---
id: B1726
title: Every page downloads two font files it never uses, and warns about it
type: ISSUE
priority: medium
complexity: low
area: layout, fonts
found: "2026-09-14T10:47:36Z"
started: "2026-09-14T10:50:30Z"
merged: "2026-09-14T10:57:55Z"
completed: "2026-09-14T16:33:03Z"
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

## Verdict

**Valid.** Confirmed against the deployed stylesheet before touching anything:
`https://fernscout.ch/_next/static/chunks/23yctgv02xx-n.css` carries two
identical latin `@font-face` rules for `Fredoka` and two for `Plus Jakarta
Sans`, the first pointing at the preloaded `-s.p.` copy and the second — the
one that wins — at the plain `-s.` copy. `app/layout.tsx:12-55` is where the
second call comes from.

## What was done

`preload: false` on `fredoka`, `jakarta` and `plexMono` in `app/layout.tsx`,
with the comments rewritten to say what the split actually does. The
latin-ext declarations are untouched.

No keeper added. The thing worth asserting is a property of the build output
(`no -s.p.` file in `.next/static/media`), and a test that reads build
artefacts is green-when-unbuilt, which is worse than no test. The comment in
`app/layout.tsx` carries the reason instead.

## Evidence

- `npm run verify` — all 5 passed in 194s, 604 test files, 7692 tests.
- Built output: `ls .next/static/media/*.woff2 | grep -c -- -s.p.` → `0`. Each
  family's latin face now appears once in the shipped CSS
  (`5d52bd6c…-s`, `fba5a26e…-s`, `99e60927…-s`).
- Served document: `curl http://127.0.0.1:3456/ | grep -c 'HL\[…font…\]'` → `0`
  font preload hints, against `3` on the live build.
- Browser, on content that predates the branch (`/example`, the demo journal's
  USA trip), 1280 and 390: `/tmp/b1726/index-{1280,390}.png`,
  `example-{1280,390}.png`, `example.json` — status 200, 0 console errors.
- Hungarian: `/tmp/b1726/example-hu-1280.png` with `fs.locale=hu`. `Oda és
  vissza`, `Áttekintés`, `Idő országonként` all render in Fredoka/Jakarta, not
  a fallback face.

The one failed request in `/tmp/b1726/index.json` is `401
/api/auth/identity/upgrade` — that is B1727, not this branch. The `404
/api/reactions` on `/example` is the capability being off locally, which
`app/api/reactions/route.ts:34` documents as deliberate.
