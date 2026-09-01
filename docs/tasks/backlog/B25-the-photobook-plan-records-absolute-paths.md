---
id: B25
title: The photobook plan records absolute paths, which breaks the depersonalisation test
type: ISSUE
priority: medium
complexity: low
area: photobook, tests
found: "2026-09-01"
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
