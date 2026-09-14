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
only. The current inventory is about 3,475 colour-utility occurrences across
151 files in `app/` and `components/`. So this is not a `dark:` sweep — the same
colour token is often used for different jobs that need different dark values.

**Plan:** `docs/plans/2026-09-13-b1541-dark-mode.md`.

## Revalidation

**Valid — 2026-09-13.** `app/layout.tsx` still advertises
`colorScheme: "light"`, `app/globals.css` still defines only the light root
palette, and there is no site-wide theme preference. The one dark treatment is
the room-scoped `.fs-room-dark` exception driven by `fs.agent.dark` in
`components/HelperRoom.tsx`; it does not affect the landing page, journals,
trips or days and is one of the conflicting controls this work replaces.

## Work

The decisions are now settled in the plan:

- Add **Automatic / Light / Dark** as a labelled radio group on `/<user>/me`,
  visible to every reader of that page, including somebody signed out.
- Treat appearance as a per-browser reader preference. Store explicit light or
  dark in `localStorage`; absence means Automatic. Nothing is written to a
  journal, account, database or API.
- Apply it to the whole browser-rendered app. Remove the helper room's separate
  dark toggle so two preferences cannot disagree; keep its text-size setting.
- Keep the existing named brand hues as primitives and introduce theme-aware
  semantic screen roles. A wholesale primitive inversion cannot work:
  `navy-900` is both strong text and a button background, and `white` is both a
  raised surface and text on dark controls.
- Set `data-theme="light"` or `data-theme="dark"` for explicit choices; leave
  it absent for Automatic. A validated pre-paint bootstrap in the root layout
  prevents a light flash and leaves Automatic to `prefers-color-scheme`.
- Change `viewport.colorScheme` to `"light dark"` and make browser chrome's
  theme colour follow the resolved appearance.
- Extend `/docs/branding/identity` and contrast tests to measure both themes.
  Yellow remains the waymark, green remains live/ahead and focus remains blue.
- Audit every drawing and visual bench in both themes. Print and print-faithful
  previews stay light, and no print renderer changes.

**Not in scope:** a per-journal dark palette an owner chooses, and anything
about dark PDF/print output or cross-device preference sync.

## Implementation notes

Implemented on `b1541-dark-mode` on 2026-09-13. The light-only utility uses
across `app/` and `components/` now point at semantic surface, ink, line,
action and overlay roles; the original brand ramps remain available for the
waymark, status accents and print work. Charts and native select popovers use
the same screen roles, while the photobook/postcard renderers and print specs
were not changed.

`components/ThemePicker.tsx` owns the browser-local radio group and
`components/ThemeScript.tsx` applies a validated explicit choice from the
document head before first paint. The latter follows Next 16's inline-script
pattern: executable in the server-rendered document and inert on client
renders, avoiding React's script warning on soft/error navigation. Automatic
stores no value and is therefore a live CSS media-query choice. The old
helper-only `fs.agent.dark` switch was removed.

Verification evidence is under
`.claude/runs/2026-09-13-b1541/B1541/`: existing landing, journal, Alps trip
and Susten day pages, `/me`, `/agent`, and all six branding workbenches were
captured at desktop and 390 px in light and dark. The interaction record at
`interaction/me-light-override.json` shows a Light click overriding a dark OS,
persisting `fs.theme=light`, and remaining selected after reload. The page
captures at `interaction/me-dark-over-light.json` and
`interaction/me-auto-live.json` also show Dark overriding a light OS and
Automatic changing from the light to dark surface on a live OS media change,
without a reload. The captures have no theme-related console error or
horizontal overflow; the demo journal's existing unauthenticated reactions
request still answers 404.

`npm run verify` passes: production build, typecheck, lint, 7,648 tests (four
environment-dependent skips), and knip. The focused theme, contrast, locale,
undefined-token, navigation and chart checks pass as 127 tests.

## Acceptance

- With no explicit choice and the OS in dark mode, the landing page, a journal,
  a trip and a day all render dark — including a day written before this branch.
- The `/me` radio group overrides the OS in both directions, survives a reload,
  and Automatic follows a live OS theme change without a reload.
- The choice affects landing, journal and helper-room pages in the same browser
  but changes no journal content or server state.
- `test/undefined-color-tokens.test.ts` still passes, and every token used in
  dark resolves.
- The identity and visual benches at `/docs/branding` are looked at in both
  themes; print output and print-faithful previews are unchanged.
- No flash of the light theme on load.
