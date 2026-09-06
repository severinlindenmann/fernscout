---
id: B529
title: npm run i18n:keys reads the locales path B510 moved away from
type: ISSUE
priority: medium
complexity: low
area: tooling, i18n
found: "2026-09-05T22:09:39Z"
merged: "2026-09-06T08:48:24Z"
---

# B529 — npm run i18n:keys reads the locales path B510 moved away from

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

`npm run i18n:keys` regenerates the `TranslationKey` union from the locale
files. It crashes:

```
Error: ENOENT: no such file or directory,
  open '.../content/locales/en.json'
```

B510 moved the instance's own four files — `config.json`, `locales/`,
`rates/`, `legal/` — out of `content/` and into `site/` in the checkout. The
script was not moved with them, so it still opens `content/locales/en.json`.

Found while building B513, which added three keys. The agent hand-edited the
`TranslationKey` union instead, which works and is exactly the drift the script
exists to prevent: the union and the locale files are now kept in step by
whoever remembers to. A generator nobody can run is worse than no generator,
because the next person assumes it ran.

Note the fallback path is real and must survive the fix: an instance that has
not migrated may still keep `locales/` beside its journals under
`CONTENT_DIR`, and AGENTS.md promises that keeps working. So the script should
prefer `site/locales/` and fall back, the way the reading code already does —
find where that resolution lives and use it rather than hard-coding a second
path.

## Work

Point the script at the same resolution the app uses. One path constant, or a
call to whatever `lib/locales.ts` already resolves.

## Acceptance

- `npm run i18n:keys` runs and leaves `TranslationKey` unchanged on a clean
  tree (it is currently correct, by hand).
- Deleting a key from `site/locales/en.json` and re-running removes it from the
  union.
