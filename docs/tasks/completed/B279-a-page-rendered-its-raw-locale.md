---
id: B279
title: A page rendered its raw locale keys to a reader instead of any text at all
type: ISSUE
priority: high
complexity: medium
area: i18n
found: "2026-09-04T12:32:35Z"
started: "2026-09-04T12:33:33Z"
merged: "2026-09-04T12:49:43Z"
completed: "2026-09-04T20:01:41Z"
---

# B279 — A page rendered its raw locale keys to a reader instead of any text at all

## Why

Reported 2026-09-04. A guest invite page, opened shortly after the journal was
created, rendered its own dictionary keys as the page text:

```
invite.guestTitle
invite.guestIntro

contact.name
contact.email
contact.emailHint

contact.language

Deutsch
invite.notYet

invite.submit
```

**It is not a missing translation.** All eight keys are present in `en.json`,
`de.json` and `hu.json` in the repository, and present in the deployed
`$CONTENT_DIR/locales/*.json` on the server. Fetching the same URL later
rendered correct German throughout — *"Lies mit bei Vikis Travels / Sag kurz,
wer du bist…"* — with no deploy or restart in between. So it is transient, and
it was not reproducible by the time anybody looked.

That is exactly why the fix should not be a hunt for the cause alone.

The likely relative is **B59** — *a new locale string renders as its own key
until the server is restarted* — which says a dictionary is cached somewhere
that can hold a stale or empty answer. `lib/locales.ts` resolves each
dictionary from two places (`$CONTENT_DIR/locales/<code>.json` first, the
shipped copy second) and memoises the result; a lookup that happened while the
journal was seconds old, or against a cache entry populated before the content
directory's copy was readable, would produce precisely this. The comment at
`lib/locales.ts:111` already notes `$CONTENT_DIR/locales/` arriving for the
first time as a case worth thinking about.

## Work

Two halves, and the second matters more than the first.

1. **Never render a bare key.** `translate()` should fall through — the
   requested locale, then the shipped dictionary for that locale, then English,
   then the key — and log once when it lands past the first step. A key is the
   one output that is certainly wrong for every reader, and the current
   behaviour hands it to them as the page. This kills the whole class whatever
   the cause turns out to be, and it is a small change at a single choke point.
2. **Then go after the cause**, with the fallback already in place so a miss is
   loud in the log rather than visible on the page. Read the caching in
   `lib/locales.ts` and ask what can populate an entry that is empty or
   partial: a first read of `$CONTENT_DIR/locales/`, a journal created between
   requests, a per-locale memo keyed before the file existed. B59 is the same
   symptom from a different direction and may fall out with it — check before
   closing either.

Do not paper over it by removing the cache; dictionaries are read on every
render and that would be a real cost. The point is that a cache miss must
degrade to English, not to machine text.

## Acceptance

- A unit test on `translate()`: a key missing from the requested locale renders
  the English string, and a key missing everywhere renders the key **and** logs.
- No page can render a string matching `^[a-z]+\.[a-zA-Z]+$` as user-visible
  text where a dictionary lookup was intended — assert it on the invite page's
  rendered markup for all three locales.
- Whatever is found about the cause is written down in `lib/locales.ts`, even
  if the answer is that it could not be reproduced.
- `npm run build`, `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`.
