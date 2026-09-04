---
id: B25
title: The photobook plan records absolute paths, which breaks the depersonalisation test
type: ISSUE
priority: medium
complexity: low
area: photobook, tests
found: "2026-09-01"
started: "2026-09-04T05:58:32Z"
session: 2b6d1969-424a-4788-9497-eb5e151a5391
claimed: "2026-09-04T05:58:32Z"
---

# B25 — Absolute paths in the photobook plan

## Why

Run `npm run photobook` for the example journal and `npx vitest run` goes red:

```
FAIL  test/depersonalised.test.ts > the example content set
  content/example/photobooks/parks-2025-plan.json matches /\bSeverin\b/i
```

Nothing personal actually leaked. The plan records image sources as absolute
paths — `/Users/severin/Documents/GitHub/fernscout/content/example/trips/…` —
and the test's `\bSeverin\b` matches the home directory in the path, not any
content. The example journal's own owner is `Alex Berger`
(`content/example/config.json`) and is correctly depersonalised.

Two things are wrong, and the second is the one worth fixing:

1. **The test scans gitignored files.** `content/*/photobooks/` is ignored, so
   this never reaches CI — it fails only on the machine of a maintainer whose
   username happens to appear in the test's name list. Which, here, is the
   person who owns the repository. Generating a photobook locally breaks your
   own test suite, and the message points at personal data rather than at a
   path.

2. **The plan should not contain absolute paths at all.** W30's acceptance
   asks that a derivative be "byte-identical across two runs of the same
   input"; a plan carrying `/Users/<whoever>/` is machine-specific by
   construction, so two people generating the same book get different bytes.
   Repo-relative paths fix the test failure as a side effect of fixing the
   reproducibility.

## Work

Write paths in the plan relative to the content root — `lib/photobook/plan.ts`
builds it and `lib/photobook/source.ts` resolves the sources. Resolve to
absolute at read time, where the renderer needs a real path.

Optionally, and separately: have `test/depersonalised.test.ts` skip paths git
ignores. Worth doing only if something else generates ignored output the test
walks into; do not do it *instead* of fixing the paths, or the reproducibility
problem stays and just stops being visible.

## Acceptance

- `npm run photobook` for the example trip, then `npx vitest run`, is green on
  a machine whose username is a personal name.
- No absolute path appears in `content/*/photobooks/*.json`.
- Two runs of the same input produce byte-identical plan JSON.

## What was built

Reproduced exactly as written: with the old code, `parks-2025-plan.json` held
44 occurrences of `/Users/severin/`, and `npx vitest run
test/depersonalised.test.ts` failed with
`content/example/photobooks/parks-2025-plan.json matches /\bSeverin\b/i`.

`BookPhoto.file` is now written relative to the content root, with forward
slashes — `bookFile()` in `lib/photobook/source.ts`. `resolvePrintFile()` is
the other half, and it is called in exactly two places: the script's
`loadImage`, and `renderPreview`, which gained a `resolveFile` parameter so
`lib/photobook/preview.ts` still needs to know nothing about the content
layout. The separate `label` field is no longer set — `file` is now readable
enough to be the label — and the script's stripping of `process.cwd()` out of
warning text went with it, since there is no longer a cwd in there to strip.

Done with B13, which lands in the same two functions: the file recorded is now
also the file actually read, which for a trip with originals is a different
file from the one the entry's frontmatter names.

**Not done: making `test/depersonalised.test.ts` skip gitignored paths.** The
task's own note says to do it only if something *else* generates ignored output
the test walks into, and nothing does — postcards and mail are the other two
generators and neither writes a path. Fixing the paths is the whole of it; a
skip would have hidden the reproducibility problem rather than solved it.

## Evidence

- `grep -c '/Users/' content/example/photobooks/parks-2025-plan.json` → 0
  (was 44).
- `npm run photobook -- --trip example/parks-2025 && npx vitest run
  test/depersonalised.test.ts` → 13 passed, on a machine whose home directory
  is `/Users/severin`.
- Two consecutive runs of the same input: plan JSON md5
  `58b81a3346ce9772cd0f78d0d7c4b8e3` both times.
- `test/photobook-source.test.ts` asserts all three acceptance lines directly.
