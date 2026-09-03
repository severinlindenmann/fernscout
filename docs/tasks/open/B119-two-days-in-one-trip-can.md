---
id: B119
title: Two days in one trip can take the same slug, and the second becomes unreachable
type: ISSUE
priority: medium
complexity: low
area: api, entries, docs
found: "2026-09-03"
---

# B119 — Two days in one trip can take the same slug

## Why

Found while verifying B77 on the live instance. B77 itself passes in full: one
`slugify`, one rule, twenty transliteration cases correct through REST, MCP and
ingest alike. This is the case on the other side of it.

Two different titles can legitimately produce the same slug. `Đà Lạt` (U+0110,
d-with-stroke) and `Ðà Lạt` (U+00D0, eth) both become `da-lat`, and that
mapping is deliberate — `lib/slug.ts` folds `[đĐðÐ]` to `d` on purpose. The
same happens for any two titles differing only in punctuation or diacritics.

The API accepts both into one trip without complaint:

```
POST …/trips/b77-slug-umlaut/days  {"title":"Đà Lạt","date":"2026-01-11"} -> 201 slug "da-lat"
POST …/trips/b77-slug-umlaut/days  {"title":"Ðà Lạt","date":"2026-01-12"} -> 201 slug "da-lat"
```

Both files are written — `2026-01-11-da-lat.md` and `2026-01-12-da-lat.md` are
both on disk. But only one can be addressed:

```
GET …/trips/b77-slug-umlaut/days/da-lat   -> the 2026-01-11 day, always
```

The second day exists, is not a draft, and cannot be reached by its permalink.
Nothing told the writer. The `201` said it worked and handed back a slug that
already belonged to something else.

`/agent.md` states plainly that **"a slug is unique within a trip"**. That is
the contract an agent writes against, and it is not true. So the failure is
worse than a collision: an agent that reads the guide has no reason to check,
and the day it just wrote for somebody is quietly unreachable. This is content
loss of the recoverable kind — the file is there — but the person is told the
day is on their site, and its URL shows a different day.

B77 explicitly scoped out anything touching existing slugs, which is why this
was left rather than folded in. It is small and it is separable.

## Work

Decide which of the two promises to keep, then keep it.

- **Refuse the write.** A `409` naming the day that already holds the slug,
  with the existing day's date, so the caller can pick a different title. This
  matches how a taken username is handled and keeps `/agent.md`'s sentence true.
- **Or disambiguate.** `da-lat-2` and a slug in the reply that differs from what
  the caller might have predicted — which is fine, because the reply is already
  the authority on what the slug is.

The first is probably right: two days in one trip with titles that differ only
by an invisible codepoint is more likely a mistake than an intention, and
silently renaming somebody's permalink has its own surprise. Either way the
caller must be told, and `/agent.md` must say what actually happens.

Check the same question for **trip ids** within a journal while in there. The
username path answers `409 username_taken`; whether two trips can collide the
same way is unverified.

Not doing: changing the transliteration. Folding `đ` and `ð` to `d` is correct
and B77 settled it.

## Acceptance

- Writing a day whose slug already exists in that trip either fails with a
  clear error naming the conflict, or succeeds with a distinct slug — not
  silently shadowed either way.
- The same through REST and MCP, since both doors write days.
- `/agent.md` describes the real behaviour; if uniqueness is enforced, the
  existing sentence stands, and if slugs are disambiguated, it is corrected.
- A test writes two titles that slug identically and asserts both days remain
  addressable, or that the second was refused.
