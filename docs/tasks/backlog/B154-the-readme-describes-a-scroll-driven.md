---
id: B154
title: The README describes a scroll-driven map and a photo journal without showing one
type: CHORE
priority: medium
complexity: low
area: readme, docs, branding
found: "2026-09-03"
---

# B154 — The README describes a scroll-driven map and a photo journal without showing one

## Why

`README.md` opens by promising "a winding day-by-day path, and a scroll-driven
animation of the travellers moving between stops" and then never shows it. The
file has 135 lines and not one image. Everything visual about this project —
the path animation, the map, the gallery, the day layout, the palette — has to
be taken on trust by somebody deciding in ten seconds whether to clone it.

For a self-hostable project, that ten seconds is the whole funnel. The demo
journal already exists (`content/example/`, five trips: `alps-2024`,
`asia-2023`, `japan-2027`, `parks-2025`, `usa-2026`) and serves at `/example`,
so there is real content to photograph — no mock-ups, and nothing personal,
which matters because `test/depersonalised.test.ts` fails the build over a real
name outside `content/`.

Related to B155, which is the prose half of the same README pass, and to B62
and B9, which are about the README's links pointing at documents that moved
into `docs/archiv/`. This task is images only and fixes no links.

## Work

Capture screenshots of the demo journal and place them in the README. Decide
and record where they live — `docs/screenshots/` is the obvious home, since
`public/` is served to browsers and these are repository documentation, not
site assets.

Which views, at minimum: the trip page with the path and map, one day entry
with a gallery, and the map or gallery view. `app/[user]/(trip)/` has the
route list — trip, `day/[slug]`, `gallery`, `map`, `costs`.

Things that will otherwise go wrong:

- **Capture against `npm run build && npm start`, not `npm run dev`.** The dev
  overlay and unoptimised images make a screenshot that is not what a visitor
  sees.
- **The scroll animation does not photograph.** A still of a scroll-driven
  scene is the weakest frame of it. Either pick the composed state deliberately,
  or accept that a short animated capture is the honest way to show that one
  feature and decide whether the repository wants a GIF/video in it at all
  (file size, and it never renders on npm or in a plain markdown viewer).
- **Both themes, or one stated.** If the site has a dark mode, a light-only
  screenshot set misrepresents it; pick one and be consistent rather than
  mixing.
- **Size.** Screenshots committed at retina resolution bloat every clone
  forever. Resize and compress, and say what the target is.
- Do not photograph anything under a real journal — `sevi`, `sevi2`, `test1`,
  the `xydhd-qa*` journals on the live instance. `content/example/` only.

Not in scope: a marketing page, an OG image (the brand skill covers that), or
screenshots in any document other than `README.md`.

## Acceptance

- `README.md` shows at least three images of the demo journal, above the
  "Running it" section, and they render on GitHub.
- Every image file is committed under a documented path and referenced by a
  repository-relative link, so it works on a clone and on github.com.
- `npx eslint .` and `npm run build` still pass; `test/depersonalised.test.ts`
  passes with the new files present.
- The total added weight is stated in the task's closing line, so the next
  person adding a screenshot knows the budget.
