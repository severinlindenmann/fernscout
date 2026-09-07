---
id: B777
title: Creating a journal validates its languages and correcting one does not
type: ISSUE
priority: medium
complexity: low
area: api, i18n
found: "2026-09-07T14:23:37Z"
started: "2026-09-07T14:25:40Z"
session: fdfcf5f2-0d32-4db4-bb1c-31e1dc373b09
claimed: "2026-09-07T14:25:40Z"
---

# B777 — Creating a journal validates its languages and correcting one does not

## Why

`POST /api/v1/journals` refuses a language outside this instance's maintained
set (`MAINTAINED_LOCALES`, `lib/i18n.ts:5` — `en`, `de`, `hu`).
`PATCH /api/v1/<user>/config` does not check at all:
`app/api/v1/[user]/config/route.ts` has no locale validation in it.

Set live on 2026-09-07: `locales: ["en","fr"]` on an existing journal returned
a plain `200 {"ok":true}`. French has no UI strings, no `fallback.writtenIn.fr`
key, and nothing to fall back to but English.

So a journal is validated when it is created and unvalidated forever after,
which is the shape of gap that produces a journal nobody can explain: the
reader sees English chrome and does not know why, and the owner set a language
the software accepted.

Found by driving the live instance as a technical user.

## Work

Validate `locales` and `defaultLocale` in the config PATCH against the same
constant the create route uses — imported, not copied. Refuse with the same
message, naming the languages this instance maintains.

Check the other `JOURNAL_PROFILE_FIELDS` for the same asymmetry while there:
anything create validates, correct should validate identically.

## Acceptance

The same value refused at creation is refused at correction, with the same
words, and a test asserts the two routes share one constant.
