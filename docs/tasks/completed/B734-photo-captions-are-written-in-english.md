---
id: B734
title: Photo captions are written in English whatever language the journal is in
type: ISSUE
priority: medium
complexity: low
area: agent, i18n
found: "2026-09-07T12:22:16Z"
started: "2026-09-07T12:55:03Z"
completed: "2026-09-07T13:35:45Z"
---

# B734 — Photo captions are written in English whatever language the journal is in

## Why

`PHOTO_SYSTEM_PROMPT` in `lib/helper/model.ts` ends with **"Write in English."**
Every other piece of writing in this product follows the person: B684's
write-day prompt says *never translate — write in the same language the person
used*, the UI comes from `site/locales/`, and B316 established the rule that
prose is not translated.

So a German journal gets German prose and English captions, on the same day, in
the same gallery. A Hungarian one gets Hungarian prose and English captions.

The instruction is understandable — a caption has no notes to take a language
from, so the prompt had to say something — but the answer is the journal's own
locale, which the request already knows.

Found while building B687.

## Work

Pass the journal's locale into the prompt and ask for captions in that
language. Check what `write-day` does for the same problem and match it.

## Acceptance

A journal whose locale is `de` gets German captions. A test asserts the
requested language reaches the prompt.

## What write-day does, and why photos cannot copy it directly

`SYSTEM_PROMPT` (write-day) never names a language at all — it tells the model
"never translate, write in the same language the person used in their notes",
because a day's prose always has notes to take a language from. A photograph
has no notes. So this is the same problem in shape ("do not default to
English") but the opposite instruction is needed: the language has to be
*told*, not *inferred*, because there is nothing to infer it from.

## What changed

`PHOTO_SYSTEM_PROMPT` (`lib/helper/model.ts`) is now built by a
`photoSystemPrompt(locale: string)` function rather than being a static
template string. The old "Write in English." sentence is replaced with:

> Write the captions in the language identified by the locale code "${locale}"
> — this journal's own language. There are no notes to take a language from
> here, unlike a day's prose, so this is told to you rather than inferred.

The `PHOTO_SYSTEM_PROMPT` export is kept (as `photoSystemPrompt("en")`) for
`test/helper-describe-photos.test.ts`'s existing assertions about the
forbidden-content rules, which do not depend on language.

`describePhotos(images, locale = "en")` (`lib/helper/model.ts:124`) takes an
optional locale and passes it to `photoSystemPrompt`, defaulting to English
for any caller that does not have one to hand (there are none in this
codebase today, but a default was cheaper than making every call site prove
it has a locale).

`app/api/helper/[user]/day/describe-photos/route.ts` now imports
`defaultLocaleFor` from `lib/locales.ts` — the same function
`localesFor`/`requestLocale` machinery is built on — and calls
`describePhotos(images, defaultLocaleFor(user))`, reading the journal's own
`config.json` `defaultLocale` rather than the reader's browser locale (there
is no reader here beyond the owner; the journal's own language is the
correct one, the same choice `write-day` makes implicitly by trusting the
notes).

## Test

`test/helper-describe-photos.test.ts`, "the journal's own locale reaches
describePhotos, not a hard-coded English": rewrites `alex/config.json` to
`defaultLocale: "de"`, calls the route, and asserts
`describePhotos.mock.calls[0][1] === "de"`. Fails before this change (the
mocked `describePhotos` was only ever called with one argument, and the real
implementation always said "Write in English." regardless of `defaultLocale`);
passes after.
