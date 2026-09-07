---
id: B235
title: Seventy-one exports and fifty-nine exported types are used only inside their own file
type: CHORE
priority: low
complexity: medium
area: repo-hygiene, types
found: "2026-09-04T08:12:38Z"
started: "2026-09-07T12:50:04Z"
merged: "2026-09-07T13:03:53Z"
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

## Done

By the time this was picked up, other merged tickets had moved the count from
130 to **153** (79 unused exports + 74 unused exported types) — `npm run
unused` at the start of this session. All 153 were unexported; the tool now
reports zero, and `"exports"` and `"types"` are `"error"` in `knip.jsonc`.

**How:** most of the 153 were `export function|const|class|interface|type|enum
NAME` on their own line — mechanically stripped the leading `export ` after
verifying, per name, that the line matched that shape exactly (not a brace-led
re-export list, which needs different handling). 139 fell into that bucket.
The other 14 were re-export chains (`export { x, y } from "./z"` or
`export { x };`), exactly the case the ticket calls out:

- Where only *some* names on the list were flagged unused, the flagged ones
  were dropped from the list and the rest kept — e.g.
  `lib/db/index.ts:12` (`export { DEFAULT_OWNER_ID, currentOwnerId, newId,
  nowIso } from "./owner"` → dropped the first two, kept `newId`/`nowIso`,
  which are used elsewhere), and the same shape in `lib/repos/index.ts`,
  `lib/db/index.ts`'s two `export type {...}` lines, `lib/travellers/shapes.ts`,
  `lib/reactions.ts` and `components/TelField.tsx`.
- Where the *whole* re-export line was flagged and the name was not used
  elsewhere in that file either (`importers/costs/schema.ts`,
  `lib/costFormat.ts`), the whole line was deleted — the underlying function
  still exists and is still exported from its actual home file; only the
  barrel re-export is gone.
- `lib/photobook/spec.ts` re-exported `MM_TO_PT` and `mm` together; only
  `MM_TO_PT` was unused, so it was dropped from both the import and the
  re-export, keeping `mm`. Doing that turned up a second-order case knip only
  surfaced after: `lib/postcard/spec.ts`'s own `export const MM_TO_PT`, which
  had been used only via that now-removed barrel — unexported it too, since it
  is still used inside its own file (`mm()` calls it).
- `lib/travellers/shapes.ts` had `export { K };` on a constant with no callers
  anywhere, including its own file beyond the declaration — removed the export
  statement, left the constant. It now shows as an unused-var eslint
  *warning* (not an error), which is a legitimate separate finding (truly dead
  code) that this ticket does not delete.

**Left exported, on purpose, with a `@public` JSDoc tag knip always
honours:** `lib/helper/transcribe.ts`'s `speechBackend` looked file-local to
knip because its only other caller is `test/helper-transcribe.test.ts` via
`vi.importActual<typeof import(...)>(...)` — a dynamic module specifier knip's
static graph can't trace, exactly the "test that imports it" risk the ticket
warned about. Re-exporting it and tagging it `/** @public ... */` (knip's
`isAlwaysIgnored` check on `@public`/`@beta`/`@alias` JSDoc tags) keeps the
export **and** keeps `exports`/`types` at `error` without a blanket ignore or
a knip.jsonc carve-out — the comment on the export explains why in place. It
was the only such case; `grep -rl importActual test/` returns just that one
file.

**`knip.jsonc` change:** `"exports"` and `"types"` moved from `"warn"` to
`"error"`; the surrounding comment block was rewritten to describe the new
split (namespace exports, enum members and duplicates stay `"warn"` — not
this ticket's scope) instead of quoting the now-stale 71/59 counts.

**Verification:** `npm run unused` exits 0 with no findings. `npm run verify`
— build, `tsc --noEmit`, `eslint .`, `vitest run` — all four passed (0
lint errors, some pre-existing unrelated warnings plus the one new `K`
warning noted above; 353 test files / 4522 tests passed).

Every removed `export` keyword is a one-line diff findable with `git log -S
"export function"`-style searches per symbol; nothing was deleted beyond the
handful of re-export list entries and lines called out above, each of which
still has its underlying declaration exported from its real file.
