# Screenshots

The pictures in the root `README.md`. They live here rather than in `public/`
because `public/` is served to browsers and these are repository documentation,
not site assets.

| File | What it shows |
| --- | --- |
| `trip-story.jpg` | `/example/trips/parks-2025` — the day rail, the day card, the route map |
| `day-entry.jpg` | `/example/trips/parks-2025/day/arches-at-dusk` — prose, gallery, reactions |
| `trip-map.jpg` | `/example/trips/parks-2025/map` — every stop, and the baked base map |
| `gallery.jpg` | `/example/trips/parks-2025/gallery` — the grid, filtered by place |

**Budget: 339 KB for the four, and that is the ceiling.** A screenshot
committed at retina resolution bloats every clone of this repository for ever.
If you add one, take something out, or make the case for the extra weight in
the commit message.

## How they were made

```bash
npm run build && PORT=3700 npm start
```

A production build, not `npm run dev` — the dev overlay and unoptimised images
make a picture that is not what a visitor sees. Then, in a browser at a
1440 × 900 viewport with the `fs.locale=en` cookie set (the demo journal
offers `en`, `de` and `hu`, and a browser asking for German gets German):
screenshot the viewport, not the full page.

Resize and compress before committing:

```bash
node -e "require('sharp')('shot.png').resize({width:1280})
  .jpeg({quality:79,mozjpeg:true,chromaSubsampling:'4:4:4'})
  .toFile('docs/screenshots/name.jpg')"
```

The quality is the knob that keeps the set under the ceiling, not a constant:
`trip-story` and `day-entry` were recaptured at 79 when B170's two-row header
pushed 80 over it. Check the total after writing a file, rather than trusting
the number in this recipe:

```bash
cat docs/screenshots/*.jpg | wc -c      # bytes; the ceiling is 347,136
```

`du` answers in allocated blocks and reports this set as 432K, which is not
what the budget is about.

**Turn the scrollbar off before the shot.** A headless Chromium draws a real
one and a Mac does not, so a capture taken with it is 15px narrower than the
other three and shows a grey stripe none of them have:

```js
// in the page, before screenshotting
document.head.insertAdjacentHTML(
  "beforeend",
  "<style>html{scrollbar-width:none}*::-webkit-scrollbar{display:none}</style>",
);
```

**And clear the origin's storage first.** `fs.lastDay:<ref>` in `localStorage`
survives between sessions, so a browser that has read this demo before shows
"Resume · Day 7" on the trip page where a first-time visitor sees the trip
opening. The README is for first-time visitors.

## Rules

- **`content/example/` only.** Never photograph a real journal. There is a test
  (`test/depersonalised.test.ts`) that keeps real names out of the code; there
  is nothing that can read a name out of a JPEG, so this one is on you.
- **Light theme, consistently.** Mixing themes across a set misrepresents both.
- **The scroll animation does not photograph.** A still of a scroll-driven
  scene is its weakest frame. The README says so in words instead; do not add
  a GIF or a video without deciding, out loud, that the repository wants the
  weight.
