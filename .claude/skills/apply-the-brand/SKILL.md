---
name: apply-the-brand
description: Use when touching the logo, wordmark, favicon, app icon, OG image or brand colours — or when adding UI, a marketing page, a PDF or an email template that needs the palette. Also use when picking a colour for text on cream or on yellow, or when something still carries the old name.
---

# Apply the brand

The product is **Fernscout** — *fern* (far) + *scout*. The mark is a Swiss
*Wanderweg* waymark: a bent cream trail, a yellow lozenge planted on it, and a
green dot already further along.

**Look at it before you change it: `/docs/branding/identity`.** That bench is
the identity's source of truth and it is derived, not written — every lockup
rendered from `docs/branding/`, every hex parsed out of `app/globals.css`,
every contrast ratio computed from those hexes. The prose manual is
`docs/branding/BRAND.md`, which the bench also renders, so the two cannot
disagree. Nothing in this skill repeats a number either (B575) — when you need
one, open the bench.

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

**Every one of them carries a copyright notice, and so does every asset in
`docs/branding/` — in the SVGs as a comment, in the PNG as metadata written by
`npm run avatar`.** Keep it when you edit one. The drawings are the strongest
right this project holds: copyright attached the moment they were drawn, with
no registration, while the *name* has no registered trademark behind it at
all. The notice is the only part of that claim that travels with a copy which
has left the repository. `LICENSE` (BRAND ASSETS) and `TRADEMARK.md` are the
terms; B657 is the reasoning.

The notice under `app/` names no holder and points at `LICENSE` instead —
`test/depersonalised.test.ts` forbids a real name there. Do not "fix" it by
adding one.

## Which file for which slot

`/docs/branding/identity` renders all of them, on the ground each is for, from
the table in `BRAND.md` §3 — which is the list, and the only one. In short:
the primary lockup on cream, an inverse for navy and photographs, a mono in
`currentColor` for one ink, the wordmark where the mark is already nearby, and
the mark alone for an icon or an avatar.

`alt-farsight.svg` and `alt-cairn.svg` are rejected directions kept with their
reasons. Never ship them.

## The name

One word, capital F, no camel case: **Fernscout**. Not *FernScout*, not
*Fern Scout*. Never split the halves across two colours or weights.

Always a proper noun, never a common one — "a Fernscout instance", never "a
fernscout". That is what keeps an unregistered mark a mark. `Fernscout™` on
first use in `README.md`, `TRADEMARK.md` and the imprints; `®` nowhere at all,
because nothing is registered and claiming otherwise is itself an offence.
Leave `site/config.json` alone — that file is the operator's, and a
self-hoster's instance must not inherit somebody else's trademark claim.

The site name is config, not a literal — read it from `serverSite().name`
(`site/config.json`). Do not hardcode it in a component.

## Colour

Use the tokens in `app/globals.css`, never a raw hex. Yellow is the brand
colour because it is the waymark; green marks something live or ahead. The
palette has six hues — a new component uses one of them, not a seventh.

**Which token may carry words is a measurement, and the bench has it.** Do not
guess from the name; two of them lie:

- `yellow-600` is a fill, not a text colour, on cream.
- `green-500` is a dot, not a label. For green text use `green-700`.

Text on `yellow-400` is `navy-900` or `yellow-950`, and nothing else. Keyboard
focus stays `blue-500` — the one palette colour clearing the non-text floor on
every surface a control sits on, yellow included.

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
| `yellow-600` or `green-500` as text | `navy-900`, or `green-700` for green — check the bench |
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
