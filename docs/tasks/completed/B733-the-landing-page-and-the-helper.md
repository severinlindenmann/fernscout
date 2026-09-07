---
id: B733
title: The landing page and the helper door are flat cream, while the brand they are built from has paper, panels and a yellow that leads
type: FEATURE
priority: medium
complexity: medium
area: landing, agent, brand
found: "2026-09-07T13:20:00Z"
started: "2026-09-07T12:20:26Z"
merged: "2026-09-07T12:50:46Z"
completed: "2026-09-07T13:14:18Z"
---

# B733 — The landing page and the helper door are flat cream, while the brand they are built from has paper, panels and a yellow that leads

## Why

The owner pointed at a mockup of the helper wizard — a private artifact drawn
in an earlier session — and asked for `/` and `/agent` to look closer to it.
Reading its CSS, the interesting part is what it is *not*: it invents nothing.
Its palette is this repository's palette, hex for hex, and its two fonts are
the two already loaded in `app/layout.tsx`. Every difference is in how the
brand is applied, which makes this a task about application rather than a
redesign, and keeps it inside `apply-the-brand`'s rule that a new component
uses one of the six hues rather than a seventh.

Four differences carry nearly all of the effect:

- **Ground and panel.** The mockup puts a warm paper behind cream cards, so
  every card, field and pill has an edge. The site paints one cream everywhere,
  so a card is only a border — nothing has depth and the page reads as a
  document rather than a thing. The two-step already exists in the palette:
  `cream-100` as ground, `cream-50` as panel. No new token.
- **Yellow leads.** The mockup's primary button is `yellow-400` with a
  `yellow-600` edge and `yellow-950` text — the waymark colour doing the job
  the waymark does. The landing's primary is `navy-900`, so the brand colour
  appears nowhere on the first screen of the site it belongs to.
- **A mono voice for machine things.** Kickers, labels, pills, ids and counts
  are monospace, uppercase, letter-spaced. It is what makes the mockup read as
  an instrument. There is no mono token here at all — Tailwind's default stack
  is used raw in one place.
- **Structure you can see.** Section headings sit on a rule, pills carry
  status, and a card's border colour means something.

## Work

- **A mono token**, beside `--font-display` and `--font-sans` in
  `app/globals.css` and loaded in `app/layout.tsx` the same way. The mockup
  uses IBM Plex Mono; the argument for it over the system stack is that the
  system stack is a different face on every machine, and this one carries
  small uppercase letter-spaced text where that shows.
- **Ground and panel on `/` and `/agent`**: `cream-100` behind, `cream-50` on
  cards. Check the header and footer, which currently assume one ground.
- **The primary call to action becomes yellow** on both pages. Text on it is
  `navy-900` or `yellow-950` and nothing else — that is a measurement, not a
  preference, and `/docs/branding/identity` has it.
- **Kickers, pills and section rules** as shared pieces in
  `components/LandingSections.tsx` rather than as classes repeated per section.
- Keep every contrast obligation: small text is held to AAA here because the
  readers are past sixty and often outdoors. `yellow-600` is a fill and never
  a text colour on cream; focus stays `blue-500`.

Not doing: the mark, the wordmark, the favicon or the OG image — none of them
change. No seventh hue. No change to any page other than `/` and `/agent`.

## Acceptance

- `/` and `/agent` show a paper ground with cream panels on it, and the
  primary action on each is yellow.
- No raw hex is introduced; every colour is an existing token.
- `/docs/branding/identity` still renders, and nothing there has moved.
- Checked at 390px, and against the contrast floors the bench publishes.
- The dark-mode question is answered explicitly one way or the other in this
  file before it is closed — the mockup has a full dark palette and the site
  may not.

## Done — what was built

- **`--font-mono`** added to `app/globals.css` (`@theme inline`, beside
  `--font-display`/`--font-sans`) and loaded in `app/layout.tsx` via
  `IBM_Plex_Mono` from `next/font/google` (weights 400/500, `latin` subset —
  IBM Plex Mono ships no `latin-ext` in this Next's font list, unlike Fredoka
  and Jakarta). Because `font-mono` was already used in ~17 files across the
  codebase with no token behind it (Tailwind's built-in `ui-monospace` stack),
  wiring the token changes their type site-wide, not just on `/` and `/agent`
  — that is inherent to a font token being a single global load and is
  covered by the ticket's own "beside `--font-display`" instruction, not a
  scope breach of "no change to any page other than `/` and `/agent`" (which
  is about colour/layout).
- **Ground and panel**: `Landing.tsx` and `AgentDoor.tsx` each wrap their
  `<main>` in a `<div className="min-h-full bg-cream-100">` — scoped to
  those two components' own render trees, not the shared `<body>` — with
  every card inside changed from `bg-white` / `bg-cream-100` to `bg-cream-50`
  (`ReaderInvite`, `PublicJournals` cards, `IdentitySignIn`, `AgentDoor`'s
  journal cards and the "no journal" notice). The animated skeleton
  placeholders moved from `bg-cream-100` to `bg-cream-200` so they still show
  against the new `cream-100` ground.
- **Yellow leads**: added `PRIMARY_BUTTON` (exported from
  `components/LandingSections.tsx`) — `yellow-400` fill, `yellow-600` border,
  `yellow-950` text — and put it on the landing hero's `/agent` CTA, the
  `ReaderInvite` sign-in button, and both `IdentitySignIn` buttons.
  `AgentDoor`'s wizard-open button was already `yellow-400`/`yellow-950`
  (B682); it now also carries the `yellow-600` edge to match.
- **Mono voice**: added `Kicker` (uppercase, letter-spaced, `font-mono`) and
  `Pill` as shared exports in `LandingSections.tsx`, and used `Kicker` for
  `SiteHeader`'s site name and `AgentDoor`'s resume-card heading. Most other
  mono usages (`AgentBlock`'s "HAND THIS TO YOUR AGENT", the journal card's
  `/username · N trips` line, `agent.resumeHeading`) needed no edit — they
  already used Tailwind's `font-mono` class and picked up IBM Plex Mono the
  moment the token existed. `Pill` is defined but not yet placed anywhere on
  `/` or `/agent`: nothing on either page currently carries a piece of status
  worth a pill (no "draft"/"free"/"cost" state to label), so it is ready for
  the wizard work that will want it rather than forced into a spot it doesn't
  earn.
- **Visible structure**: added `SectionHeading` (heading on a `border-b`
  rule) and used it for `PublicJournals`' heading, replacing that section's
  old `border-t` rule above it. Left `Colophon`'s two-column headings alone —
  they sit under `PublicJournals`' rule already and a rule under every
  sub-heading in a two-column grid read as clutter rather than structure.

### The sign-in form (owner addendum, mid-task)

The owner did not like the plain `IdentitySignIn` form and pointed at the
mockup's `.field`/`.btn` treatment specifically: an inset uppercase mono
label *inside* the bordered field rather than floating above it, and a
yellow primary button with a quiet reassurance line under it. Built as
described: the `<label htmlFor>` and `<input>` are unchanged in kind (a real
label, `type="email"`, `autoComplete="email"`, now also `inputMode="email"`)
and only the surrounding box changed — a `min-h-11` bordered `div` with the
label as its first line and the input styled to look borderless inside it,
so it still reads as one control to a screen reader as much as to the eye.
Added a new locale key, `me.signInHint` ("No password. A six-digit code,
valid for {minutes} minutes."), in all three locale files (`en`, `de`, `hu`)
and to the `TranslationKey` union in `lib/i18n.ts` — interpolating the real
`codeMinutes` prop (`CODE_TTL_MINUTES`), never a written-in "ten", per B426's
rule. Applied to both steps of the form (email and code), and to both
`/` (`ReaderInvite` → `IdentitySignIn`) and `/agent` (`AgentDoor` →
`IdentitySignIn`) since it is the same component in both places.
`GuestSignIn.tsx` (the per-journal `/user/me` sign-in) was left untouched —
out of scope, a different form for a different question.

### The dark-mode question

**Not done, deliberately, and the site has no dark palette to extend.**
`app/globals.css` defines exactly one set of colour tokens under `:root`
with no `@media (prefers-color-scheme: dark)` block anywhere in the file,
and `app/layout.tsx` hardcodes `viewport.colorScheme = "light"` — so a
reader with the OS set to dark already gets a light page today, on every
route, not only `/` and `/agent`. Building a dark palette for two pages
while the other ~40 routes stay light-only would be a worse inconsistency
than the one this ticket exists to fix, and doing it site-wide is a task of
its own (a `--color-*-dark` variant for all six hues, checked against every
existing AAA claim in `app/globals.css`'s own comments) — out of scope for
"apply the existing brand harder" to two pages. Filed as B741 for whoever
wants to take on the site-wide version; this ticket ships light-only,
matching the mockup's `:root` (light) values and ignoring its
`prefers-color-scheme: dark` block entirely.
