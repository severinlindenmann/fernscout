---
id: B741
title: The site has no dark palette at all, though the brand mockups already draw one
type: FEATURE
priority: low
complexity: medium
area: brand
superseded: "B1541"
found: "2026-09-07T12:37:09Z"
---

# B741 — The site has no dark palette at all, though the brand mockups already draw one

## Why

Superseded by B1541, which is the same problem captured on 2026-09-11 as a
`big-feature` rather than a `small-feature`, and which carries the decision
this file left open. Both describe one light-only palette in
`app/globals.css`, `colorScheme: "light"` hardcoded in `app/layout.tsx`, and a
brand mockup that already draws a complete dark block.

B1541 adds what is missing here: the measured scale of the change (~1,565
hardcoded colour-utility uses across 121 components), the choice between
flipping the token hexes under a dark selector and renaming the tokens
semantically first, and the four drawing benches at `/docs/branding` needing
their own pass. The AAA re-audit and the `/docs/branding/identity` check this
file asks for survive into it unchanged.

Found while building B733 (yellow-led ground/panel treatment for `/` and
`/agent`). Its mockup — a private artifact drawn against this brand — ships a
complete dark `:root[data-theme="dark"]` / `prefers-color-scheme: dark`
block: every token from `--page` to `--cost-bg` gets a dark counterpart. This
site has none of it. `app/globals.css:1-110` defines exactly one palette
under bare `:root`, with no `@media (prefers-color-scheme: dark)` anywhere in
the file, and `app/layout.tsx`'s `viewport` hardcodes
`colorScheme: "light"`. A reader with their OS set to dark already gets a
fully light page on every one of this site's ~40 routes today — B733 did not
create that gap, it only made it visible by drawing attention to a mockup
that assumes one.

## Work

- Decide whether dark mode is wanted at all before drawing anything — this is
  a product decision (does a travel journal read by someone's family in bed
  need one?), not just an engineering one.
- If yes: a `--color-*-dark` variant for each of the six hues plus
  `--background`/`--foreground`, under `@media (prefers-color-scheme: dark)`
  in `app/globals.css`, checked against every existing AAA/contrast claim
  already written as comments in that file (the navy ramp split by job is
  calibrated against `cream-50`/`cream-100` specifically and cannot be
  assumed to still clear AAA against a dark ground without recomputing).
  `/docs/branding/identity` computes its ratios from the hexes in this file,
  so it is the way to check the new values rather than eyeballing them.
- Remove the hardcoded `colorScheme: "light"` in `app/layout.tsx`'s
  `viewport`, and decide whether `data-theme` needs a user-facing toggle or
  should just follow `prefers-color-scheme`.
- Site-wide, not a page at a time — a dark palette used on two routes and
  nowhere else is a worse inconsistency than none at all.

Not doing: reproducing the mockup's `--sky`/`--coral` dark values verbatim
without checking them — they were drawn for a helper-wizard mockup, not
computed against this repo's actual hexes.

## Acceptance

- `app/globals.css` has a dark block, or this task is closed with a written
  decision that the site stays light-only and why.
- `/docs/branding/identity` shows every dark-mode text/background pairing
  clearing the same AAA floor the light palette holds itself to.
- Checked with the OS (or the browser's emulated) colour scheme set to dark,
  on at least `/`, `/agent` and one journal page.
