---
id: B24
title: Nothing notices when a file stops being used
type: CHORE
priority: low
complexity: low
area: repo-hygiene
found: "2026-09-01"
---

# B24 — Nothing notices when a file stops being used

## Why

A sweep for unreferenced files, run 2026-09-01, found almost nothing. That is
the finding, and it cuts both ways.

Every module under `components/` and `lib/` is imported by something except
one:

```
UNREFERENCED: lib/mapProjection.d.ts
```

— which is a declaration file for `lib/mapProjection.mjs` and is referenced by
the type system rather than by name, so it is a false positive and the sweep
found zero real orphans. `public/` holds one file, `sw.js`. `.gitignore` is
thorough — `.next`, `*.tsbuildinfo`, `.DS_Store`, generated per-user output,
export zips, the media cache — and nothing generated is tracked. The twelve
largest tracked files are the demo photographs, which are supposed to be there.

So the repository is clean today. Nothing keeps it that way. The four checks
in `AGENTS.md` — `tsc`, `eslint`, `vitest`, `build` — all answer "does what is
here work", and none answers "is anything here for nothing". `package.json` has
no `knip`, no `depcheck`, no `ts-prune`, and eslint is not configured to flag
unused exports. A file that stops being imported keeps compiling, keeps
passing, and keeps being read by the next person as though it mattered.

The cost is not disk. It is that dead code is indistinguishable from live code
when you are reading it to find out how something works — and this codebase is
written to be read, with the reasoning in the comments. A comment explaining
why something is shaped the way it is, in a file nothing calls any more, is
worse than no comment.

## Work

1. Add an unused-code check and wire it into the verification set. `knip` is
   the one that covers all three cases in one pass — unreferenced files,
   unused exports, and unused dependencies — and understands a Next.js app's
   entry points, which is the part a naive grep gets wrong (routes, layouts,
   `instrumentation.ts`, `proxy.ts`, `public/sw.js` and the `scripts/` CLIs are
   all entered without being imported).
2. Configure the entry points first and get it to zero on today's tree. A check
   that starts life with forty findings is a check people learn to ignore.
3. Suppress the `.d.ts` case rather than deleting it.
4. Decide whether it joins the four commands in `AGENTS.md` or runs on its own.
   It is slower than `tsc` and the answer changes rarely; a separate script
   that a person runs occasionally may be the honest fit. Say which in the
   file, so the next person is not left guessing whether it is meant to be
   green.

Not doing: deleting anything in this task. There is nothing to delete — the
sweep found none. If the tool finds something once configured, that is a
separate task per finding.

## Acceptance

- One command reports unreferenced files, unused exports and unused
  dependencies, and reports none on the current tree.
- Its entry-point configuration covers `app/` routes, `instrumentation.ts`,
  `proxy.ts`, `public/sw.js`, `scripts/*` and `test/*`.
- Where it belongs in the verification routine is written down.
