---
id: B1811
title: The cover step shows eight photographs and tells the person the rest come later
type: FEATURE
priority: high
complexity: low
area: photobook composer
found: "2026-09-16T18:10:51Z"
started: "2026-09-16T18:14:22Z"
merged: "2026-09-16T19:18:48Z"
---

# B1811 — The cover step shows eight photographs and tells the person the rest come later

## Why

The first-book wizard's cover step asks "Welches Foto kommt vorne drauf?" and
answers itself: "Das Buch wählt selbst ein gutes aus. Später stehen alle Fotos
zur Auswahl." (`photobook.first.cover` / `photobook.first.coverHint`,
`site/locales/{de,en,hu}.json:2050-2051`).

The step is not a promise — it already **is** a picker
(`app/[user]/(trip)/photobook/FirstBookFlow.tsx:463-502`), a radiogroup of image
buttons each writing `set("cover", tile.src)` at `:492`. It is capped at eight by
`media.slice(0, 8)` (`:485`), with a comment at `:483` giving the reason: a first
choice with a good default behind it, the full set being the settings panel's
job.

The owner, on 2026-09-16, does not want to be sent away for that. Being told the
rest come "später" in the one step that is asking the question is the part that
reads badly.

The full set already exists a few files over, in
`app/[user]/(trip)/photobook/BookSettingsPanel.tsx:355-397` — the same tile grid
unsliced (`media.map` at `:374`), writing the same `BookOptions.cover` field
(`:381`), behind a `coverOpen` disclosure (`:286`, `:347-352`). Both are handed
the identical `media: MediaTile[]` prop from `PhotobookPageContent.tsx:680` and
`:701`, sourced once server-side at `:87/104`. Nothing needs fetching.

## Work

The owner chose, on 2026-09-16: **keep the eight, and put a "show all" toggle in
the step.** The default stays a curated first choice; expanding reveals the
whole set in place, without leaving the wizard.

- Lift the cap behind a piece of local state in the cover step, and give the
  expanded grid a bounded height with its own scroll — a 280-photograph trip
  must not turn the step into a page nobody can reach the bottom of.
- Rewrite `photobook.first.coverHint` so it no longer says the rest come later,
  since they no longer do. Real German, English and Hungarian; run
  `npm run i18n:keys` after the English.
- Label the toggle itself as a new string in all three languages.

The two grids are now the same component in all but name
(`FirstBookFlow.tsx:465-500`, `BookSettingsPanel.tsx:355-397`). Factoring them
into one shared picker is optional and only worth it if the toggle would
otherwise be written twice — do not extract an abstraction for its own sake.

Not doing: changing what the settings panel offers, or the "let the book decide"
default tile. Both stay as they are.

## Acceptance

- In the wizard's cover step, a control shows every photograph of the trip
  without leaving the step, and choosing one there sets the book's cover — seen
  in a browser on a real trip, at desktop and phone width, with the resulting
  cover visible in the preview.
- The hint no longer refers to a later chance to choose, in all three languages.
- A trip with many photographs does not make the step unscrollably long on a
  phone.
- `npm run verify` green, `npm run i18n:keys` clean.

## Done, 2026-09-16

Built as the owner decided: local `showAllCovers` state in `FirstBookFlow.tsx`,
a "Show all photographs" toggle under the grid, and the expanded grid gets
`max-h-[60vh] overflow-y-auto` so a large trip scrolls inside the step instead
of growing it. `photobook.first.coverHint` rewritten in all three languages to
stop promising a later chance; new keys `photobook.first.coverShowAll` /
`coverShowFewer` for the toggle's two states (German, English, Hungarian —
written by hand, not machine-translated). `npm run i18n:keys` run after.

Did not touch `BookSettingsPanel.tsx` — its own unsliced grid already does the
"show everything" job for the returning-owner composer, and duplicating the
toggle there was not needed to satisfy this ticket (ticket said extraction is
optional and only worth it if the toggle would otherwise be written twice —
it wasn't).

Verified on the demo journal's `parks-2025` trip (43 photographs, pre-existing,
untouched by this branch) at 390px and 1280px: expanded the toggle, selected a
photograph past the original eight (`independence-pass/01.jpg` at desktop,
`needles-district/02.jpg` at phone width), advanced to the composer, and
confirmed the chosen photograph rendered as the book's front cover in the live
preview — both via `localStorage`'s persisted `BookOptions.cover` and visually
in the flip-book preview. No console errors on a fresh navigation.

**One unrelated pre-existing failure found in `npm run verify`**, present
identically on `main` before this branch touched anything:
`test/task-ids.test.ts` fails because three tasks in `backlog/wont-do/` are
misfiled against their frontmatter's declared category folder (from the
2026-09-16 triage commit). Not something this branch caused or fixed — captured
separately as B1817. Everything else in `npm run verify` is green (ESLint and
knip run standalone as confirmation, since the aborted `vitest` step meant
`verify` itself did not reach them).
