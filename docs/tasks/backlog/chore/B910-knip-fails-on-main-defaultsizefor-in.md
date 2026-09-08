---
id: B910
title: knip fails on main: defaultSizeFor in lib/photobook/spec.ts is exported and called by nothing
type: CHORE
priority: medium
complexity: low
area: photobook
found: "2026-09-08T05:16:41Z"
---

# B910 — knip fails on main: defaultSizeFor in lib/photobook/spec.ts is exported and called by nothing

## Why

`npm run unused` — the last step of `npm run verify`, and its own CI job —
fails on `main` as it stands:

```
Unused exports (1)
defaultSizeFor  function  lib/photobook/spec.ts:122:17
```

Nothing in the repository calls it (`grep -rn defaultSizeFor` finds the
declaration and nothing else). Its doc comment describes a wizard behaviour —
falling back when a cover stops offering the chosen size — so the honest
question is whether the wizard was meant to use it and does not, which is a
bug in the photobook flow rather than a lint finding.

Found while merging B903/B904: a clean branch fails `verify` at the last step
for a reason that is nobody's on that branch, which is exactly the round-trip
`verify` running knip locally was meant to prevent (B24).

## Work

Decide which it is, and do that one:

- The wizard should be calling it — wire it up, and the export stays.
- It is genuinely spare — drop the `export` keyword, or delete the function.

Whoever owns the photobook cover/size wizard should answer; this task is
deliberately not making that call from the outside.

## Acceptance

- `npm run unused` exits 0 on `main`.
