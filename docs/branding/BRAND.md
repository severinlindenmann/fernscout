# Fernscout — corporate design

The identity manual: what the name means, what the mark may and may not do,
and which colour and type decisions are already settled so nobody has to
re-litigate them in a pull request.

Assets live beside this file. `fernscout-logo.svg` is the primary lockup;
everything else is a variant of it.

## 1. The name

**Fernscout** — *fern* (German: far, distant) + *scout*.

The old name, Reisepost, described mail **arriving**: news from far away,
landing at home. Fernscout describes the opposite direction of travel. A scout
goes out **ahead** of you, covers ground you have not covered, and reports
back. That is what the product actually is now: an agent that walks the trip
with you, keeps the record, and hands it back written.

Say it as one word. Never *FernScout*, *Fern Scout*, or *fern-scout*, and
never split the halves across two colours or two weights — the name is one
thing, not a compound to be pulled apart.

Domain: **fernscout.ch**.

## 2. The mark

A Swiss *Wanderweg* waymark: the painted yellow lozenge that tells a hiker
both that they are on the route and which way it runs.

Three elements, and each one means something:

| Element | Colour | Reads as |
|---|---|---|
| Bent trail | cream `#fffaf0` | the route — bent, never straight, because trips are not |
| Lozenge | Wanderweg yellow `#ffd23f` | the waymark planted on it: **you are here** |
| Leading dot | green `#22c55e` | the scout, already further along than you are |

Two of these are inherited verbatim from the Reisepost envelope mark — the
bent route line and the green dot. The rebrand is a change of metaphor, not a
break in visual lineage, and the navy rounded-square container (rx 21 at 96px)
is unchanged so the icon drops into every existing slot without relayout.

### Why this one

Three directions were drawn and rendered at a true 16×16 raster before the
choice was made (`alt-farsight.svg`, `alt-cairn.svg` are kept alongside):

- **farsight** — a scout's lens, the land curving away inside it. The most
  explicitly agentic of the three, and the best of them at large sizes. At
  16px it collapsed into a pale disc with every interior element below one
  pixel, and it reads as a generic "search" glyph.
- **cairn** — stacked stones, one per logged day. Structurally the truest
  metaphor. It survived 16px, but reads as a *layers* or *database* icon, and
  a mark that needs explaining is not doing its job.
- **waymark** — the only one whose silhouette is a single convex shape with no
  interior detail to lose. It is also the only one that is specifically Swiss,
  which a `.ch` product should not waste.

The lozenge was enlarged (half-diagonal 21 → 23 on the 96 grid) after the
first render came back under-weight at favicon size. Re-test at 16px before
changing its geometry again; do not eyeball it.

## 3. Lockups

| File | Use |
|---|---|
| `fernscout-logo.svg` | primary, horizontal, on cream |
| `fernscout-logo-inverse.svg` | on navy or photography — container dropped |
| `fernscout-logo-mono.svg` | one ink; `currentColor`, recolour at point of use |
| `fernscout-wordmark.svg` | where the mark already appears nearby |
| `fernscout-mark.svg` | 96px — app icon, avatar, favicon source |
| `icon-waymark.svg` | 32px viewBox — the wired favicon |
| `fernscout-avatar-640.png` | **derived** — for slots that refuse SVG |

**The PNG is the one file here that is not a source.** Some slots refuse SVG
— a WhatsApp Business profile picture is the case that forced it — and they
also crop to a circle, so it is flattened onto the plate's own navy rather
than left transparent. The mark's extremities sit 44.9 units from centre
against a 48 radius, so nothing is clipped by that crop.

Regenerate it with `npm run avatar`, **in the same commit that changes the
mark**. It is a fourth copy of geometry that BRAND.md otherwise keeps in one
place, it cannot be diffed, and it will not complain when it goes stale —
which is exactly how a logo update ships everywhere except the avatar nobody
thought to re-export.

**Clear space:** one lozenge half-diagonal (23 units at 96 scale) on all four
sides. Nothing enters it, including page edges.

**Minimum sizes:** mark 16px. Full lockup 120px wide — below that the wordmark
counter shapes fill in and you should switch to the mark alone.

**Never:** recolour the lozenge; straighten the trail; separate the dot from
the trail's leading end; add a gradient, bevel or shadow; set the wordmark in
anything but Fredoka; place the cream trail on a ground lighter than navy-700.

Outline the wordmark text before sending any of these files outside the repo.
Fredoka is not installed on a stranger's machine, and the SVGs fall back to
Trebuchet MS, which is not the brand.

## 4. Colour

The palette is unchanged from Reisepost — it was already good, and the rebrand
is identity, not redesign. What changes is the **ranking**: yellow is now the
brand colour rather than one accent among several, because it is the waymark.

Tokens are defined once in `app/globals.css`. Use the token, never the hex.

| Role | Token | Hex |
|---|---|---|
| Brand / waymark | `yellow-400` | `#ffd23f` |
| Ink / ground | `navy-900` | `#1e293b` |
| Paper | `cream-50` | `#fffaf0` |
| The scout, live position | `green-500` | `#22c55e` |
| Distance, water | `sky-400` | `#5ec8dc` |
| Accent, used sparingly | `coral-400` | `#f06a8a` |

### Contrast — measured, not assumed

| Pair | Ratio | Verdict |
|---|---|---|
| navy-900 on cream-50 | 14.06 | body text |
| navy-900 on yellow-400 | 10.13 | the only text colour for yellow buttons |
| yellow-950 on yellow-400 | 8.24 | alternative ink on yellow |
| cream-50 on navy-900 | 14.06 | inverse text |
| green-700 on cream-50 | 4.82 | AA text |
| navy-500 on cream-100 | 5.02 | secondary text |
| coral-600 on cream-100 | 4.94 | AA text |
| **yellow-600 on cream-50** | **2.36** | **fill only — never text, despite the name** |
| **green-500 on cream-50** | **2.19** | **fill only — never text** |

Two traps worth stating out loud: `yellow-600` looks like a text-safe yellow
and is not, and `green-500` is a dot colour, not a label colour. For green
text on cream use `green-700`.

Keyboard focus stays `blue-500` `#2f6fed` — it is the one palette colour
clearing 3:1 against every surface controls sit on, including yellow-400.

## 5. Typography

- **Display / wordmark** — Fredoka 700. Rounded and warm; it kept the product
  from reading as a dashboard under the old name and it still does.
- **Body** — Plus Jakarta Sans.

Fredoka is used with restraint: the wordmark, page titles, and the big numbers
on the overview. It is not a UI font — buttons, labels and body copy are
Jakarta.

Fredoka was chosen for a friendlier, postcard-ish brand. Fernscout is a little
more purposeful, and a narrower, more technical display face is a legitimate
future question — but changing it is a site redesign, and is deliberately out
of scope for the rebrand.

## 6. Iconography

So later icons look related rather than merely adjacent:

- 24px grid, 2px strokes, round caps and joins — the trail in the logo is the
  reference stroke.
- Geometric, not illustrative. No outlines around filled shapes except where
  the mark itself does it, for separation on navy.
- Yellow marks a place or a state. Green marks something live or ahead. Navy
  is structure. Do not use green and yellow decoratively; in this system they
  carry meaning.

## 7. Motion

`path-pulse` in `app/globals.css` is the house animation: the leading dot
breathing on the trail. It is the one piece of ambient motion — the scout is
alive and ahead of you. Everything else animates on interaction only, and all
of it respects `prefers-reduced-motion`.

## 8. Voice

Plain, specific, unhurried. The product tells someone where they went and what
it cost; it does not sell them the trip back to themselves.

- Say what happened: "Bus to Hoi An, 4h 20m." Not "An unforgettable journey."
- Sentence case everywhere, including buttons.
- German and English both read naturally — the name is half of each, and so is
  the audience. Avoid idiom that only survives in one.

## 9. Trademark

The code is AGPL-3.0. The **name and the mark are not** — see `TRADEMARK.md`.
Forks are welcome and must rebrand: unregistered word mark *Fernscout* and the
waymark device, no implication of endorsement.
