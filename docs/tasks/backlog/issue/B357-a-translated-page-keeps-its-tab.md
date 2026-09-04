---
id: B357
title: A translated page keeps its tab title in the journal's default language
type: ISSUE
priority: medium
complexity: low
area: i18n
found: "2026-09-04T19:57:28Z"
---

# B357 — A translated page keeps its tab title in the journal's default language

## Why

A trip page requested in `de` renders in German throughout —
`<html lang="de">`, translated trip title and tagline from the `translations`
block, translated chrome, correct date formats. The `<title>` element stays in
the journal's default language.

Observed 2026-09-04 on fernscout.ch, `/xydhd-lifecycle/trips/andes-2025?lang=de`:

- `<h1>` — "Der lange Weg nach Salta" ✓
- `document.title` — "The long way to Salta · The Lifecycle Journal" ✗

The German title exists; it is in the same frontmatter the heading is read
from. Same on a day page: "Ohrid, from the water — Ohrid · …" over fully
German content.

B225 is this on the landing page. These are two more instances, on the pages a
reader actually shares, where the tab and the bookmark carry a language they
did not ask for.

## Work

The metadata function for the trip and day routes resolves the locale already
(the page under it does). Have it prefer the translated title where one exists,
falling back to the default as now.

## Acceptance

A trip and a day page requested in `de`, where a German title exists, have a
`<title>` in German.
