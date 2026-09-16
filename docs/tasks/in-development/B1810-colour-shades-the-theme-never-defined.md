---
id: B1810
title: Colour shades the theme never defined fall back to Tailwind's own palette, so cards and banners stay light in dark mode
type: ISSUE
priority: high
complexity: medium
area: dark mode, photobook, postcards
found: "2026-09-16T18:10:43Z"
started: "2026-09-16T18:14:21Z"
session: 5728e1b2-3fad-40e0-b87e-adbfa4c2dc7f
claimed: "2026-09-16T18:14:21Z"
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

## Resolution

Confirmed valid and considerably wider than the "Where it shows" list: a
repo-wide scan of every `bg|border|text|…-<hue>-<shade>` class against
`@theme`'s tokens found 37 undefined-shade occurrences on ambiguous hues, not
only `yellow`/`red` — also `green-600`, `green-800` and `sky-50/100/200`. The
acceptance line ("no remaining occurrence… in `app/` or `components/`") is a
blanket rule, so all of them were fixed, not only the photobook/postcard
files named above.

Decision made once, applied everywhere:
- **The caution-banner pattern** (`border-yellow-600 bg-yellow-50 …
  text-yellow-900`, already the deliberately contrast-checked shape in
  `HelperRoom.tsx`'s low-credits notice, B1155) is now backed by real tokens:
  `--color-yellow-50/100/900` added to `app/globals.css`, light values equal
  to Tailwind's own stock hexes (what was already rendering), dark values
  following B1798's method — `yellow-900` (text) reuses `yellow-400`'s own
  hex (10.38:1 on the new dark fill) rather than inventing a new step.
  `BookLevelView.tsx`, `PhotobookPageContent.tsx`, `PostcardSend.tsx` and
  `postcards/[id]/page.tsx` were normalised onto this exact class string
  (their `border-yellow-300`/`border-yellow-700` variants folded into
  `border-yellow-600`).
- **"Chosen" cards** (`FirstBookFlow.tsx`, both spots) swapped `bg-yellow-50`
  for `bg-surface-selected`, the house pattern the ticket named
  (`LocaleSwitcher`/`ThemeSwitcher`), keeping `border-yellow-600` as the
  accent.
- **Wrong-shade copies** (`yellow-500` → `yellow-600` in
  `BookSettingsPanel.tsx`, `DayControls.tsx`, `PostcardCropper.tsx`;
  `green-800` → `green-700` in `HelperRoom.tsx`, `extract/DayBoard.tsx`)
  matched to the sibling line already using the defined shade.
- **`text-red-700`** (11 files, all error text — admin panels and the
  `extract` flow) swapped to `text-coral-600`, the existing, already
  dark-flipped error-text token used everywhere else in the app for exactly
  this role. No new red ramp invented.
- **`green-600`** (`RoomOpening.tsx`'s WhatsApp button) swapped to
  `green-500` + `text-on-bright` + `hover:brightness-110`, matching
  `GamePath.tsx`'s already-shipped `border-green-700 bg-green-500
  text-on-bright` combo instead of reusing `green-700` as a *background*
  (that token was deliberately redefined for dark-mode *text* by B1798, and
  using it as a fill would make the button glow bright green in dark mode).
- **`sky-50/100/200`** (badges, icon circles and branding-workbench ground
  panels) collapsed onto `sky-300`, the one pale sky shade this app already
  defines and pairs with `text-on-bright`/translucent fills elsewhere.

Added `test/undefined-color-tokens.test.ts`'s missing guard: a second test
extending the same file, checking `sky`/`yellow`/`green`/`blue`/`red` (the
ambiguous hues the original test's own comment named but did not assert)
against every `--color-*` token defined anywhere in `globals.css`. Verified it
fails on `main` (37 findings) and passes after the fix (0) — see the session
report for both outputs.

`lib/photobook/render.ts` (the printed book) was not touched, per the ticket.

**Second, unrelated problem found and filed separately (not fixed here):**
`npm run verify`'s vitest stage fails on a pre-existing issue —
`test/task-ids.test.ts` rejects three tickets the recent wont-do triage moved
into `backlog/wont-do/` because their `type`/`complexity` frontmatter still
names their old category folder. Confirmed pre-existing on `main` before this
branch touched anything. Filed as B1818.

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
