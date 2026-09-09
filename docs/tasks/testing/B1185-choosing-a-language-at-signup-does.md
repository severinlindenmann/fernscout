---
id: B1185
title: Choosing a language at signup does not set the person's own reading language
type: ISSUE
priority: medium
complexity: low
area: signup, i18n
found: "2026-09-09T20:58:16Z"
started: "2026-09-09T20:58:35Z"
merged: "2026-09-09T21:06:35Z"
---

# B1185 — Choosing a language at signup does not set the person's own reading language

## Why

SignupWizard asks which language the journal is written in (B838) and
sends it as `defaultLocale` — but never sets the `fs.locale` cookie, so
the person who just said "German" continues through the rest of signup,
and lands in the agent room, in English. The one answer they gave about
language is not applied to the person who gave it. Owner-directed,
2026-09-09.

## Work

When the journal-language answer changes, write the same cookie
`LocaleSwitcher` writes (reusing its exported setter, or the same
one-liner) and re-render — the wizard's own strings follow immediately.

## Acceptance

Choosing Deutsch in the signup wizard flips the wizard itself into
German, and /agent afterwards opens in German.
