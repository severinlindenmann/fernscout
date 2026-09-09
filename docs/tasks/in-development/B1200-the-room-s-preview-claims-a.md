---
id: B1200
title: The room's preview claims a German day is written in English
type: ISSUE
priority: high
complexity: low
area: helper room, i18n
found: "2026-09-09T22:54:56Z"
started: "2026-09-09T22:55:26Z"
session: b9809a36-bbcb-4095-a4b1-58adf1c351c6
claimed: "2026-09-09T22:55:26Z"
---

# B1200 — The room's preview claims a German day is written in English

## Why

Margrit retest (live, 2026-09-10): the room's preview showed *"Auf
Englisch geschrieben — dieser Tag hat keine deutsche Fassung"* over a day
whose title and body were plainly German. The public page never shows it.
Root: the room renders `DayCard` under the ROOT layout's `LocaleProvider`,
which passes no `writtenLocale`, so it defaults to `"en"`
(`components/LocaleProvider.tsx:68`) — the provider's own comment says the
journal layout is "the only place a day is ever rendered", which stopped
being true when the room grew a preview. A false claim about the person's
own words, the exact class AGENTS.md's net exists for, drawn by layout
plumbing rather than a model.

## Work

`app/agent/page.tsx` wraps the room in a nested `LocaleProvider` carrying
the chosen journal's `defaultLocale` as `writtenLocale` (same locale and
dictionary as the root). Correct the stale comment in LocaleProvider.

## Acceptance

A German journal's German draft previews in the room with no fallback
banner; a genuinely untranslated day still shows it (existing behaviour on
journal pages unchanged).
