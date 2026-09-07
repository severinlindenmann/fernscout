---
id: B734
title: Photo captions are written in English whatever language the journal is in
type: ISSUE
priority: medium
complexity: low
area: agent, i18n
found: "2026-09-07T12:22:16Z"
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
