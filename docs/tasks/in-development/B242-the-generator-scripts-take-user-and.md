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

## Acceptance

- `npm run postcard -- --user ../../escaped …` refuses and writes nothing.
- `npm run photobook -- --trip ../../x/y` refuses and writes nothing.
- A test covers both, alongside the ones in `test/generator-output.test.ts`.
