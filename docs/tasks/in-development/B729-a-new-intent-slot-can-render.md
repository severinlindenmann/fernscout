---
id: B729
title: A new intent slot can render its own translation key
type: ISSUE
priority: low
complexity: low
area: agent, i18n
found: "2026-09-07T12:16:38Z"
started: "2026-09-07T12:55:01Z"
session: 97b44327-dee7-4b48-bf97-305a0b3d1f54
claimed: "2026-09-07T12:55:01Z"
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
