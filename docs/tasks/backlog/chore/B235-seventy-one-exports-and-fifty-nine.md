---
id: B235
title: Seventy-one exports and fifty-nine exported types are used only inside their own file
type: CHORE
priority: low
complexity: medium
area: repo-hygiene, types
found: "2026-09-04T08:12:38Z"
---

# B235 — Seventy-one exports and fifty-nine exported types are used only inside their own file

## Why

Found while building B24, which added `npm run unused` (knip). The sweep B24
was written from looked only at whole files and found nothing; the tool looks
at the export graph and finds 130 things:

```
Unused exports (71)
Unused exported types (59)
```

Nothing is broken. Every one of them compiles, and most are a single word —
`export` in front of a helper that only its own file calls. `generateToken` in
`lib/auth/index.ts:114` is the shape of it: exported, and referenced once,
twelve lines further down the same file.

The cost is the same one B24 names and is worth restating, because it is not
about disk. An `export` is a claim that something is part of an interface, and
a reader deciding whether they may change a function reads that claim. Seventy
of them that are not true make the sixty that are unreadable.

Two groups inside the 130 are worth separating before anyone starts, because
they want different answers:

- **Genuinely internal.** Drop the `export`. The large majority.
- **Exported for a test that no longer imports it**, or for a future caller
  that never arrived. Deleting the export changes nothing; deleting the code
  might. Check each.

## Work

- Work through `npx knip --include exports,types` in batches by directory, not
  in one pass. Each batch is `tsc`, `eslint`, `vitest`, `build`.
- Remove the `export` keyword where the symbol is used only in its own file.
  **Do not delete the symbol** — that is a different decision, and if a whole
  function turns out to be dead it is its own capture.
- When a group is finished, move that rule from `warn` to `error` in
  `knip.jsonc` so it cannot come back. That is the point of the exercise; the
  cleanup on its own does not hold.

**Not doing:** the `files`, `dependencies`, `unlisted` and `binaries` rules —
B24 already put those at `error` and they are at zero.

## Acceptance

- `npx knip` reports no unused exports and no unused exported types.
- `"exports"` and `"types"` are `"error"` in `knip.jsonc`.
- Nothing was deleted that a `git log -S` cannot account for.
