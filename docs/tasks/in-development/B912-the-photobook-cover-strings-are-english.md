---
id: B912
title: The photobook cover strings are English in the Hungarian file
type: CHORE
priority: medium
complexity: low
area: photobook, i18n
found: "2026-09-08T05:23:21Z"
started: "2026-09-08T06:18:35Z"
session: 41335894-5435-4167-8cb6-898e370cd6a9
claimed: "2026-09-08T06:18:35Z"
---

# B912 — The photobook cover strings are English in the Hungarian file

## Why

The soft/hardcover step added in B845 ships `photobook.first.coverType`,
`photobook.first.coverType.soft`, its hint, the hardcover pair, the panel's
equivalents and `photobook.size.pocket`. English and German are written
properly. **Hungarian is the English text, copied**, because the agents that
wrote them were told not to invent Hungarian and that was the right call.

`test/locales.test.ts` only asks that every shipped key exists in every
locale, so nothing fails — a Hungarian reader simply meets English in the
middle of a Hungarian wizard.

The same is true of `pricing.rowPhotobookPrint` and its detail, added when the
build and print charges were split.

## Work

A person who reads Hungarian translates those keys in `site/locales/hu.json`.
Nothing else changes.

## Acceptance

- No English sentence left in `hu.json` for the keys above.
