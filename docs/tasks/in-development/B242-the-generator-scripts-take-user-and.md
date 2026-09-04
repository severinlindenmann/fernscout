---
id: B242
title: The generator scripts take --user and --trip as directory names without checking them
type: ISSUE
priority: medium
complexity: low
area: postcards, photobook, scripts
found: "2026-09-04T08:32:00Z"
started: "2026-09-04T16:07:52Z"
session: 46daaba3-3210-4263-85a6-d285caefd837
claimed: "2026-09-04T16:07:52Z"
---

# B242 — The generator scripts take --user and --trip as directory names without checking them

## Why

Found while building B219, which moved both scripts' output directory from
`process.cwd()` to `contentRoot()`. Moving the root made it obvious that
nothing checks what is joined onto it.

`scripts/postcard.ts:110` joins `--user` straight on:

```
const outDir = path.join(contentRoot(), owner, "postcards");
```

and `scripts/photobook.ts:131` does the same with the username it slices off
the `--trip` ref. Neither goes near `ID_PATTERN`, `parseTripRef()` or anything
else that treats a username as the directory name it is. Demonstrated:

```
$ CONTENT_DIR=/tmp/root node scripts/postcard.ts --user ../../escaped \
      --photo … --message hi --to recipients.json
Wrote 8 file(s) to /tmp/../../escaped/postcards/
```

Eight files, four of them carrying a recipient's full postal address, written
to a directory chosen by an argument rather than by the content model.

How much this is worth is a judgement, and the honest version is: the argument
comes from whoever is already running the script on the box, so this is not a
privilege boundary being crossed. What it is, is the one rule AGENTS.md states
about usernames — "a username is a directory name and therefore a security
boundary" — not being applied at the two places that write the most sensitive
files in the repository. It is also how a typo silently creates
`content/exampel/postcards/` and a person spends ten minutes wondering where
their cards went.

## Work

- Refuse a `--user` and a `--trip` ref that are not the shape the content
  model allows, before anything is written. `lib/ingest/paths.ts` already
  restates `ID_PATTERN` for a CLI that cannot import the `server-only`
  modules, and both scripts can use it — the photobook one already imports
  server-side modules and could use `parseTripRef()` directly.
- Say which argument was wrong, rather than failing on the mkdir.

**Not doing:** validating that the user *exists*. A postcard run for a journal
that has not been created yet is a reasonable thing to do, and B219 is about
where files land, not who may run the script.

### Built as

Exactly as scoped above, nothing more:

- `scripts/postcard.ts` imports `ID_PATTERN` from `lib/ingest/paths.ts` and
  checks `owner` against it immediately after the existing `--to`/
  `--from-contacts` checks, before `hasContactsKey()`, the backend check, or
  anything in `main()` — so the refusal lands before the photo is even read.
- `scripts/photobook.ts` imports `parseTripRef` from `lib/trips.ts` directly
  (it already goes through `--conditions=react-server`, the same as
  `lib/photobook/source.ts`'s own imports of `lib/trips.ts`, so this adds no
  new constraint). The check runs immediately after the "no `--trip`" usage
  check and before the backend/size/binding checks and the `mkdirSync`. The
  parsed `{ username, tripId }` also replaces the old hand-sliced `bookOwner`
  and `bookSlug` — one parse instead of two ad hoc string slices agreeing with
  it by luck.
- Neither script checks the user or trip *exists* — a run for a journal not
  yet on disk still works, unchanged.

## Acceptance

- `npm run postcard -- --user ../../escaped …` refuses and writes nothing.
  Verified directly: `CONTENT_DIR=<scratch> npm run postcard -- --user
  ../../escaped --photo … --message hi --to /dev/null` exits 1 with
  `--user "../../escaped" is not a username: lowercase letters, digits and
  dashes, and not starting with a dash.` on stderr, and nothing appears
  anywhere outside `<scratch>` (checked with `find`).
- `npm run photobook -- --trip ../../x/y` refuses and writes nothing.
  Verified directly: exits 1 with `--trip "../../x/y" is not
  <username>/<trip-id> — both need to be lowercase letters, digits and dashes,
  and not start with a dash.` on stderr, nothing written.
- A test covers both, alongside the ones in `test/generator-output.test.ts`:
  `"--user is a directory name, and a traversal in it is refused before
  anything is written (B242)"` and `"--trip is a directory name, and a
  traversal in it is refused before anything is written (B242)"`. Each asserts
  the *exact* directory the pre-fix code would have written to (mirroring the
  vulnerable expression literally) does not exist afterwards.
- `npm run verify` passes in the worktree: build → tsc (0 errors) → eslint (0
  errors, 4 pre-existing unrelated warnings) → vitest (169 files, 2477 passed,
  3 skipped — Postgres-only, no local Postgres in this environment).
