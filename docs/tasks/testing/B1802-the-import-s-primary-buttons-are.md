---
id: B1802
title: The import's primary buttons are cream on cream in dark mode, and its pages have no header
type: ISSUE
priority: high
complexity: low
area: extract, dark mode, nav
found: "2026-09-15T14:36:31Z"
started: "2026-09-15T14:36:32Z"
merged: "2026-09-15T14:53:25Z"
---

# B1802 — The import's primary buttons are cream on cream in dark mode, and its pages have no header

## Why

Two things, both reported from a phone against the live instance.

**The buttons cannot be read in dark mode.** Five of them across the import use
`bg-ink-strong ... text-white`:

- `components/extract/ResumeScreen.tsx:68`
- `components/extract/UploadStep.tsx:236` and `:245`
- `components/extract/AskCard.tsx:72`
- `components/extract/PhotoChips.tsx:125`

`--ink-strong` is `#1e293b` in light and `#f2ecdd` in dark — it is the *ink*
token, and it flips with the theme. So in dark mode the fill turns cream and the
label stays white: cream on cream. The owner's screenshot shows two "Weiter"
buttons that are, in their words, impossible to read.

The pair that exists for this is `--action-strong` / `--on-action`.
`action-strong` is the same hex as `ink-strong` in both themes, but `on-action`
flips with it — `#fffaf0` light, `#171d29` dark. A button painted with the fill
token and labelled with the ink token is legible in both; one painted with a
token that flips and labelled with a literal is legible in one.

This is a near relative of B1798: the same class of mistake, a token used in a
slot it was not chosen for, one theme later.

**The pages have no header.** `components/PageHeader.tsx` is a sticky header
carrying a back link, the journal's name, the section, and both the locale and
appearance switchers. Its own comment records that it replaced a four-row stack
with exactly that set, and a dozen owner pages use it. The import does not: it
hand-rolled a single back link and has no way to change language or theme.

## Work

**The buttons:** `bg-action-strong text-on-action` on all five. Then grep the
whole branch for `text-white` beside a themed background — the five above were
found by grepping `components/extract/`, and the same pattern may sit elsewhere
in the feature.

**The header:** use `PageHeader` on the import's pages rather than the
hand-rolled link, and delete the hand-rolled one. Read a current caller — for
instance `app/[user]/contacts/page.tsx` — for what it expects in context; it
reads the trip and site providers, and the import has no trip, which the
component already handles (`useTrip()` is null outside a trip and it falls back).

If `PageHeader` genuinely does not fit a page with no trip, say so with what you
found rather than building a second header. A second header is how a codebase
ends up with two that drift.

## Acceptance

- Every primary button in the import is legible in both themes, checked at a
  contrast floor of 4.5:1 and in a real browser at 390px in dark.
- The import's pages carry `PageHeader`, so back, language and appearance are
  all reachable from the top of every screen.
- No `text-white` remains on a themed background anywhere in the feature.
- Captures kept for both themes.

## Related

B1798 fixed the hues; this is the same mistake in the fill/ink pairing.
