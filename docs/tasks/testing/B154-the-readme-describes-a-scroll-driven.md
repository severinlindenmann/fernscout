---
id: B154
title: The README describes a scroll-driven map and a photo journal without showing one
type: CHORE
priority: medium
complexity: low
area: readme, docs, branding
found: "2026-09-03"
started: "2026-09-04T05:58:30Z"
merged: "2026-09-04T06:22:16Z"
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

---

## Resolution — 2026-09-04

Four screenshots, in a new **What it looks like** section between the intro and
*Running it*. Committed under `docs/screenshots/`, which the task named as the
obvious home and which is right for the reason it gave: `public/` is served to
browsers and these are repository documentation.

| File | View |
| --- | --- |
| `trip-story.jpg` | `/example/trips/parks-2025` — the day rail, the day card, the route map |
| `day-entry.jpg` | `…/day/arches-at-dusk` — prose, a three-photo gallery, the reaction row |
| `trip-map.jpg` | `…/map` — eighteen stops and the baked base map |
| `gallery.jpg` | `…/gallery` — the grid, filtered by place |

**Total added weight: 339 KB** (74 / 93 / 57 / 115). That is the budget, and
`docs/screenshots/README.md` says so, along with how they were captured so the
next set matches.

On the four things the task said would otherwise go wrong:

- **Production build.** `npm run build && PORT=3700 npm start`, not `npm run dev`.
- **The scroll animation.** Not faked and not GIF'd. The composed state was
  picked deliberately — the day rail with the map beneath it — and the README
  says in words that scrolling walks the travellers between stops and that a
  still cannot show it. A GIF was considered and rejected on weight.
- **Themes.** Light, all four, and `docs/screenshots/README.md` states it.
- **Size.** Captured at a 1440 × 900 viewport in CSS pixels (not device
  pixels — retina would have quadrupled the bytes for nothing), resized to
  1280 wide, JPEG q80 with mozjpeg and no chroma subsampling, which keeps the
  UI text crisp.

One thing worth knowing for the next capture, now written down in
`docs/screenshots/README.md`: the demo journal offers `en`, `de` and `hu`, and
a browser that asks for German gets German. The first pass was captured
entirely in German before anybody noticed. Set `fs.locale=en`.

## Acceptance — met

- `README.md` shows four images of the demo journal above *Running it*; all
  four are repository-relative links that render on github.com and on a clone.
- Every file is committed under a documented path — `docs/screenshots/`, with
  its own README listing what each one is.
- `npx eslint .` and `npm run build` pass; `test/depersonalised.test.ts`
  passes. (It scans `lib app components scripts public`, so `docs/` is outside
  its reach either way — but the rule it enforces was still obeyed: only
  `content/example/` was photographed, never `sevi`, `sevi2`, `test1` or the
  `xydhd-qa*` journals.)
- Added weight stated above: **339 KB**.

### Noticed, not absorbed

Two things the screenshots made visible, both captured rather than quietly
fixed:

- **B211** — the demo journal's photographs come from Lorem Picsum and have
  nothing to do with the places they are captioned with. `gallery.jpg` labels a
  seascape "Wind Cave National Park"; the Arches day shows a building facade, a
  slot canyon and a sand dune. It is a deliberate trade-off
  (`scripts/build-demo-content.mjs:18` — nothing to license) that only starts
  to cost something now that these pictures are the README.
- **B212** — the journal title truncates to "Ferns…" in the trip header at
  1440 px, with empty space beside it. Visible in `trip-story.jpg` and
  `day-entry.jpg`. The screenshots were left honest rather than doctored.
