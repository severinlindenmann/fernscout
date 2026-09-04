---
id: B371
title: The markdown twin of a day carries only the default locale, so a translated day has no readable source
type: ISSUE
priority: low
complexity: low
area: api
found: "2026-09-04T21:10:30Z"
started: "2026-09-04T21:24:46Z"
merged: "2026-09-04T21:42:57Z"
---

# B371 — The markdown twin of a day carries only the default locale, so a translated day has no readable source

## Why

Found while fixing B356 (which added `translations` to the JSON read-back).

`lib/api/markdownTwin.ts`'s `render()` emits the default-locale frontmatter and
prose only -- no `translations:` block at all. The entry file on disk carries
them; the twin does not.

The guide sells the twin as the source rather than the rendering: "append `.md`
to a day's own URL and you get the source that produced it ... nothing is lost
in the conversion -- there is no conversion." For a journal declaring two or
more locales that is not true. Half of what was written is missing, and it is
the half a reader in the other language actually sees.

## Work

Emit the `translations:` block in the twin, in the shape it is written in.
Decide deliberately whether a twin fetched under a non-default locale should
lead with that locale instead -- and say which in the guide either way.

## Acceptance

A day written in two languages, fetched as `.md`, shows both.
