---
id: B1541
title: There is no dark mode; the whole app is cream and yellow at 2am
type: FEATURE
priority: medium
complexity: high
area: UI / theming
found: "2026-09-11T21:02:39Z"
---

# B1541 — There is no dark mode; the whole app is cream and yellow at 2am

## Why

Every page of this app is light, unconditionally. `app/layout.tsx:98` declares
`colorScheme: "light"`, and there is not one `dark:` utility in `app/` or
`components/` — a reader who has their phone in dark mode gets a full-brightness
cream page in bed, which is where a lot of a travel journal is read.

The cost is that the palette is not written for it. `app/globals.css` defines
one set of hexes on `:root` and the ramps are named for a light ground: the
navy ramp goes dark-text-on-cream and the contrast split documented in that file
(navy-900 headings … navy-500 never text) is a statement about cream backgrounds
only. There are ~1565 hard-coded colour-utility uses across 121 components. So
this is not a `dark:` sweep — it is a decision about whether the tokens become
theme-aware.

## Work

Not decided yet; the ticket exists to hold the decision. Two shapes, and the
first is much the smaller diff:

1. **Tokens flip, components don't.** Keep every `text-navy-700` /
   `bg-cream-50` exactly as written and redefine the hexes under a dark
   selector — meaning the ramps stop being "navy" and "cream" literally and
   become semantic (ink, ground). One CSS block, no component edits, but the
   token names lie in dark and the brand yellow needs its own answer.
2. **Semantic rename first**, then theme the new tokens. Honest names, 1565
   call sites to migrate.

Either way:

- Three states, not two: `data-theme="light"`, `data-theme="dark"`, and absent
  meaning follow `prefers-color-scheme`. Dark must not require a toggle press.
- `colorScheme` in `app/layout.tsx` becomes `"light dark"`.
- The brand is not free to invert — `apply-the-brand` decides what the mark,
  the wordmark and the yellow do on a dark ground.
- The drawings are the hard part and no test covers them: the travel animation,
  the traveller figures, the day card, the print layouts. Print never goes
  dark. `/docs/branding/*` is where each is looked at.
- Contrast has to be re-audited on the dark ground, to the same AAA-at-11px bar
  the light palette is held to; `/docs/branding/identity` computes it from the
  hexes.
- Where the preference is stored, if a toggle exists at all, and whether it is
  per-journal or per-reader.

**Not in scope:** a per-journal dark palette an owner chooses, and anything
about the PDF/print renderers.

## Acceptance

- With no explicit choice and the OS in dark mode, the landing page, a journal,
  a trip and a day all render dark — including a day written before this branch.
- A toggle (if built) overrides the OS in both directions, and the choice
  survives a reload.
- `test/undefined-color-tokens.test.ts` still passes, and every token used in
  dark resolves.
- The four benches at `/docs/branding` are looked at in both themes, per
  `check-a-drawing`; print output is unchanged.
- No flash of the light theme on load.
