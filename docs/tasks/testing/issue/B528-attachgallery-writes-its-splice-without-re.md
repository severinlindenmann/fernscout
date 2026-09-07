---
id: B528
title: attachGallery writes its splice without re-reading it, where editEntry refuses
type: ISSUE
priority: medium
complexity: low
area: media, entries
found: "2026-09-05T21:37:26Z"
started: "2026-09-07T10:37:38Z"
merged: "2026-09-07T11:05:28Z"
---

# B528 — attachGallery writes its splice without re-reading it, where editEntry refuses

## Why

Two functions in `lib/api/entries.ts` splice text into a day's frontmatter and
write it back, and only one of them checks that what it wrote still parses.

`editEntry` (`lib/api/entries.ts`) runs `matter(spliced).data` inside a
`try/catch` before `fs.writeFileSync`, and refuses with "this is a bug; please
report it" rather than writing a file nothing can read. `attachGallery` — the
media endpoint's path — calls `appendGallery` and writes the result straight
out.

Found while building B522, which put caller-supplied text (`caption`) through
`attachGallery` for the first time. The specific hole B522 opened is closed:
`galleryLines` had a private escaper that missed control characters, and it now
uses the shared `quoteScalar`, which cannot emit invalid YAML whatever it is
handed. So this is no longer a live exploit — it is the missing second defence,
and the pairing `lib/validate/frontmatter.ts` argues for out loud in its own
header ("deliberately both rather than either alone").

Cost of leaving it: a day written unparseably is invisible at every reading
path *and* undeletable through the API, because every delete path resolves the
day first. That is what B204 cost — a permanently consumed trip id, recoverable
only with a shell on the server. The next field added to a gallery item is one
`quoteScalar` call away from repeating it, and nothing would fail.

## Work

- Parse the spliced string before writing in `attachGallery`, the way
  `editEntry` already does, and return the same `bug: true` shape so the route
  answers 500 with a sentence rather than a corrupt file.
- The files are already on disk by then, so the refusal has to say so: the
  201's `attached: false` branch already exists for a hand-shaped file, and
  this is a second reason to take it.

Not doing: a third defence at `appendGallery` itself, which is pure and has no
opinion about files.

## Acceptance

- A test that hands `attachGallery` an item whose caption would produce
  unparseable YAML (bypassing validation, the way `test/edit-day.test.ts`'s
  "smuggled past the type system" test does) leaves the day on disk unchanged
  and readable.
- `npm run verify` green.

## Resolution

Confirmed still live: `attachGallery` wrote `spliced` straight to disk with no
parse check, unlike `editEntry`. Added the same guard `lib/api/entries.ts:706`
runs before `editEntry`'s write — `matter(spliced).data` in a `try/catch`,
refusing with `bug: true` and a sentence naming what would have happened
(`lib/api/entries.ts`, in `attachGallery`, just before the `fileUnchangedSince`
check). The return type gained `bug?: boolean` on its `ok: false` branch; the
media route already forwards only `.ok`/`.error` to callers, so no route
change was needed for the guard to take effect — it already takes the
existing `attached: false` path.

`quoteScalar` protects every scalar it is asked to quote; `width`/`height` are
still written unquoted (`width: ${item.width}`) because they are typed as
numbers — a value smuggled past the type system there is exactly the gap this
guard closes, and is what the new test exercises.

Test: `test/photo-captions.test.ts`, "an item smuggled past the type system
that would write unparseable YAML is refused, and the day is unchanged" —
fails against the old code (the file would be written with broken YAML and
the assertion on `result.ok`/`onDisk()` would fail), passes now.

`npm run verify` green (see final report).
