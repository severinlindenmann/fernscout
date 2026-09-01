---
id: B59
title: A new locale string renders as its own key until the server is restarted
type: ISSUE
priority: low
complexity: low
area: i18n, dx
found: "2026-09-01"
started: "2026-09-01"
merged: "2026-09-01"
---

# B59 — A new locale string renders as its own key until the server is restarted

## Why

Found while checking B54 on a dev server that had been running since before the
change. The page rendered:

```html
<h1 …>map.titlePlanned</h1>
```

The key, in the heading, in place of the sentence. The file on disk was
correct and so was the code; the server had read `content/locales/en.json` at
boot and never looked again.

`readDictionary` (`lib/locales.ts:82`) caches per `contentRoot()::code` and the
cache is only ever populated, never invalidated:

```ts
const key = `${contentRoot()}::${code}`;
const hit = cache.get(key);
if (hit) return hit;
```

`clearLocaleCache()` exists directly below it and is labelled *"Test seam"* — it
is called from tests and from nothing else.

**The same file family solves this two directories away.** `lib/entries.ts:85`
keys its cache on a signature built from every `.md` file's name, `mtimeMs` and
`size`, and recomputes when that changes. That is why adding a day shows up on
the next request while adding a locale string does not, on the same server, in
the same process. One of the two caches checks whether the disk moved and the
other assumes it never will.

Two things make it worth fixing rather than remembering.

**The failure mode reads as a broken build, not as a stale cache.** A raw key in
an `<h1>` looks like the translation was never written. The natural next move is
to go back and check the JSON — which is correct — rather than to restart
anything.

**It applies to the instance's own overrides, not just development.**
`localeFiles(code)` merges a per-instance override file over the shipped
strings, so an author editing their own copy on the VPS gets the same silence
until the process is restarted. That is a content edit behaving unlike every
other content edit on the site.

## Work

Give the locale cache the same staleness check the entry cache already has: key
it on the dictionary files' `mtimeMs`/`size` alongside the locale code, and
re-read when that signature changes. `entriesSignature` is the shape to copy,
and there are at most a handful of files per locale rather than a directory of
days, so the `stat` cost is not a consideration.

**Not doing:** a file watcher, HMR integration, or any invalidation triggered
from outside `lib/locales.ts`. The `stat`-on-read approach is what the rest of
the content layer does and is enough.

Worth checking whether `lib/i18n.ts`'s client-side dictionary needs anything —
it receives a flat object from the server per render, so it should follow for
free, but confirm rather than assume.

## Built

`readDictionary` now stats the files it is about to read and keys the cache on
`name:mtimeMs:size` per file, exactly as `entriesSignature` does in
`lib/entries.ts`. Nothing outside `lib/locales.ts` changed, and no watcher was
added.

Two things worth recording:

- **A missing file is part of the signature**, as `-`. Without that, the
  interesting case would still be broken: `$CONTENT_DIR/locales/` *arriving*
  where there was none is a change from absent, and that is precisely what B56
  makes a deploy do to a process that is already running and already serving.
  The two tasks are one behaviour between them — B56 gets the file onto the
  machine, B59 makes the machine notice.
- **`lib/i18n.ts` needed nothing**, confirmed rather than assumed: editing
  `en.json` under a running production server changed both the rendered `<h1>`
  and the dictionary serialised into the RSC payload for `LocaleProvider`, in
  the same request. The client is handed a flat object per render and has no
  cache of its own.

`clearLocaleCache()` stays. It is still the right tool for a test that points
`CONTENT_DIR` somewhere new, and the signature is deliberately coarse — two
writes to one file inside the same millisecond, ending at the same length, look
identical to it. That is the same trade `lib/entries.ts` makes.

## Acceptance

- With the dev server running, adding a key to `content/locales/en.json` and
  reloading renders the string, not the key.
- The same holds for a per-instance override file.
- A test asserts a second `dictionaryFor` call after a file write returns the
  new value, and that an untouched dictionary is not re-parsed on every call.
- `npx tsc --noEmit`, `npx eslint .`, `npx vitest run` and `npm run build` pass.
