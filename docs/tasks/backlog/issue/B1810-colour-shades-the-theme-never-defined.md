---
id: B1810
title: Colour shades the theme never defined fall back to Tailwind's own palette, so cards and banners stay light in dark mode
type: ISSUE
priority: high
complexity: medium
area: dark mode, photobook, postcards
found: "2026-09-16T18:10:43Z"
---

# B1810 — Colour shades the theme never defined fall back to Tailwind's own palette, so cards and banners stay light in dark mode

## Why

Reported by the owner on 2026-09-16 about the photobook's step-by-step first
book, which "sometimes looks a bit bad" in dark mode. It is not confined to the
photobook, and it is not a matter of taste: a whole family of colour classes in
this repository never flips theme at all.

`app/globals.css` defines the brand yellows as exactly four shades — `300`, `400`,
`600`, `950` (`globals.css:69-72`, re-exported `:161-164`). Tailwind ships its own
`yellow` and `red` palettes under the same names, so any shade this project did
**not** define still compiles: `bg-yellow-50`, `text-yellow-900`,
`border-yellow-300`, `border-yellow-500`, `border-yellow-700`, `text-red-700`
all resolve silently to Tailwind's stock hex, which is fixed in both themes and
was never contrast-checked against this app's dark surfaces.

`test/undefined-color-tokens.test.ts:18-24` already names this hazard and
deliberately leaves it unguarded. This is the ticket it was waiting for.

Where it shows, confirmed by reading the class lists against the token
definitions:

- `app/[user]/(trip)/photobook/FirstBookFlow.tsx:109` — the **chosen** answer
  card is `border-yellow-600 bg-yellow-50`. Every picked answer in the wizard
  (cover type, size, text, layout, extras, language) draws as a near-white box
  on the dark panel.
- `FirstBookFlow.tsx:410` — the same pair on the day include/exclude toggle.
- `app/[user]/(trip)/photobook/PhotobookPageContent.tsx:633` — the order-outcome
  banner is `border-yellow-300 bg-yellow-50 text-yellow-900`, all three stock:
  a pale card with dark-brown text sitting on a dark page.
- `BookLevelView.tsx:140,367,388` — same pattern; `:618,625` use `text-red-700`,
  Tailwind's dark red on a dark navy ground.
- `DayControls.tsx:232` and `BookSettingsPanel.tsx:383` — `border-yellow-500`
  where every sibling line in the same files uses `yellow-600`. A wrong-shade
  copy rather than a theme fault, but it is the same undefined-shade mistake.
- Outside the photobook, the identical banner pattern is in
  `app/[user]/postcards/[id]/page.tsx:479` and `PostcardSend.tsx:197`.

The owner decided on 2026-09-16 that the fix goes everywhere rather than being
patched in the wizard alone.

The pattern to follow is B1798, which did exactly this for `green-700` and
`coral-600` — redefine the text-bearing shades under both dark blocks
(`globals.css:224` and `:288`) rather than inventing a new scheme. For a chosen
state specifically, `LocaleSwitcher.tsx:101` and `ThemeSwitcher.tsx:124` are the
house pattern: the row keeps a surface token and the accent is carried by
`text-selected-mark`, which flips.

## Work

Two parts, in one branch:

1. Remove every use of an undefined shade. Either define the missing shades for
   both themes the way B1798 did, or swap the usage to a semantic token
   (`bg-surface-selected` for a chosen card, the existing notice tokens for the
   banner). Decide once and apply it the same way in all the places listed
   above, photobook and postcard alike.
2. Add the guard `test/undefined-color-tokens.test.ts` says is missing: a test
   that fails when a Tailwind colour class names a shade `@theme` does not
   define. Without it this comes back the next time somebody types `yellow-50`.

Two things to check with eyes rather than by reading, because they cannot be
settled from the CSS: the progress dots at `FirstBookFlow.tsx:281`
(`bg-yellow-600` filled against `bg-surface-selected` unfilled — whether
"filled" still reads as different on a dark ground), and whether the
self-contained `yellow-600/400/950` pairings stay legible. If they do, leave
them; a pairing that is internally readable in both themes is not a defect.

Not doing: a redesign of the wizard, or any change to the printed book's
colours. `lib/photobook/render.ts` has its own palette and paper is not themed.

## Acceptance

- The photobook wizard at `/[user]/trips/<trip>/photobook`, in dark mode, at
  desktop and phone width: every chosen card, the day toggles and the outcome
  banner sit on surfaces that belong to the dark theme. Screenshots before and
  after, on a trip that existed before the branch.
- The postcard pages carrying the same banner, likewise.
- `npm run verify` green, including the new undefined-shade test, which fails on
  `main`.
- No remaining occurrence of a Tailwind colour shade that `@theme` does not
  define, in `app/` or `components/`.
