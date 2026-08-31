---
name: apply-the-brand
description: Use when touching the logo, wordmark, favicon, app icon, OG image or brand colours — or when adding UI, a marketing page, a PDF or an email template that needs the palette. Also use when picking a colour for text on cream or on yellow, or when something still carries the old name.
---

# Apply the brand

The product is **Fernscout** — *fern* (far) + *scout*. The mark is a Swiss
*Wanderweg* waymark: a bent cream trail, a yellow lozenge planted on it, and a
green dot already further along. Full manual: `docs/branding/BRAND.md`.

## The one rule

**Never redraw the mark. Reference the file.**

The geometry is tested, not eyeballed — the lozenge was resized once because a
16px render came back weak. Re-typing path data into a new component silently
forks it, and the fork is always slightly wrong. If a slot cannot take an SVG
file, copy the paths verbatim from `docs/branding/fernscout-mark.svg` and say in
a comment where they came from.

Three files carry their own copy of the geometry and must be kept in step:
`app/icon.svg` (the favicon asset itself), plus `app/apple-icon.tsx` and
`app/opengraph-image.tsx`, which inline the paths because `ImageResponse`
cannot load a file. All three hold the waymark. When the mark changes, all
three change. There is no fourth.

## Which file for which slot

| Slot | File |
|---|---|
| Anywhere on cream | `docs/branding/fernscout-logo.svg` |
| On navy or a photo | `fernscout-logo-inverse.svg` |
| One ink — print, embossing | `fernscout-logo-mono.svg` (`currentColor`) |
| Mark alone — icon, avatar | `fernscout-mark.svg` (96) · `icon-waymark.svg` (32) |
| Mark already nearby | `fernscout-wordmark.svg` |

`alt-farsight.svg` and `alt-cairn.svg` are rejected directions kept with their
reasons. Never ship them.

## The name

One word, capital F, no camel case: **Fernscout**. Not *FernScout*, not
*Fern Scout*. Never split the halves across two colours or weights.

The site name is config, not a literal — read it from `serverSite().name`
(`content/config.json`). Do not hardcode it in a component.

## Colour

Use the tokens in `app/globals.css`, never raw hex. Yellow `#ffd23f` is the
brand colour because it is the waymark; green marks something live or ahead.

Two traps that have already caused bugs — both are **fill-only** colours whose
names suggest otherwise:

- `yellow-600` on cream is **2.36:1**. It is not a text colour.
- `green-500` on cream is **2.19:1**. It is a dot colour. For green text use
  `green-700` (4.82:1).

Text on `yellow-400` is `navy-900` (10.13:1) or `yellow-950` (8.24:1) — nothing
else. Keyboard focus stays `blue-500`; it is the only palette colour clearing
3:1 on every surface controls sit on, yellow included.

## Verify at 16px before you claim it works

A mark that reads at 64px can dissolve into noise in a browser tab. Scaling the
SVG up in a viewer re-renders it sharply and proves nothing — you have to
rasterise at 16 and blow the *bitmap* up:

```bash
node .claude/skills/apply-the-brand/favicon-check.mjs docs/branding/icon-waymark.svg
```

It writes `favicon-check.png` (gitignored) with the mark at 16, 24 and 32px.
Look at it. Interior detail and strokes under ~1.5 units at the 32 grid are the
first things to go.

Run this after any change to the mark's geometry, and after touching
`app/icon.svg`, `app/apple-icon.tsx` or `app/opengraph-image.tsx`.

## Common mistakes

| Mistake | Fix |
|---|---|
| Redrawing the lozenge "close enough" | Copy the file |
| `yellow-600` or `green-500` as text | `navy-900`, or `green-700` for green |
| Hardcoding "Fernscout" in a component | `serverSite().name` |
| New colour for a new component | The palette has six. Use one. |
| Changing the mark, shipping without the 16px check | Run the 16px check above |
| Gradient, bevel or shadow on the mark | None. Ever. |

## The old name

The project was called **Reisepost** until August 2026, and the rename is
finished: nothing in the code, the scripts or the deployment carries it any
more. Where it still appears — `docs/branding/BRAND.md`, `docs/runbook.md` —
it is deliberate history, explaining why the palette and the deployment names
are what they are. Leave those.
