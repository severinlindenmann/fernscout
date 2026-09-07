---
id: B729
title: A new intent slot can render its own translation key
type: ISSUE
priority: low
complexity: low
area: agent, i18n
found: "2026-09-07T12:16:38Z"
started: "2026-09-07T12:55:01Z"
completed: "2026-09-07T13:19:12Z"
---

# B729 — A new intent slot can render its own translation key

## Why

`components/HelperAsk.tsx:210` labels a slot with `agent.slot.<name>` cast
through `as TranslationKey`. The cast is what makes it compile; it also means a
registry row whose slot nobody translated renders the raw key — `agent.slot.foo`
— on the page, instead of failing the build the way every other missing key
does.

The registry exists so adding a capability is one row. This is the one way that
row can be wrong and still ship.

## Work

A test that walks `REGISTRY` and asserts every slot name has a key in all three
locales. Cheap, and it turns the cast back into something safe.

## Acceptance

Adding a registry row with an untranslated slot fails the suite.

## Work done

Added `test/helper-slot-locales.test.ts`: walks every slot name across every
`REGISTRY` row and every `MAINTAINED_LOCALES` code, reading each locale's own
`site/locales/<code>.json` off disk directly (not the English-merged
`dictionaryFor()`, which would hide a slot missing from one language behind
English's copy of the same key) and asserting `agent.slot.<name>` exists there
as a non-empty string. All 15 current checks (5 slot names × 3 locales) pass.
Adding a registry row with a slot name absent from even one locale file now
fails this suite. No production code changed — `components/HelperAsk.tsx:210`
still casts, but a missing key can no longer ship silently.
