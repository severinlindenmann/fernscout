---
id: B24
title: Nothing notices when a file stops being used
type: CHORE
priority: low
complexity: low
area: repo-hygiene
found: "2026-09-01"
started: "2026-09-04T07:43:09Z"
merged: "2026-09-04T08:11:43Z"
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

### The sweep was looking at the wrong thing, 2026-09-04

**"The sweep found zero real orphans" was true and misleading, and correcting
it changes what this task can promise.** The 2026-09-01 sweep asked only
whether a *file* was reachable. Once knip was configured and asked about the
export graph as well, the tree turned out to be carrying:

```
Unused files (0)          — the original finding, and it holds
Unused dependencies (0)
Unlisted imports (0)
Unused exports (71)
Unused exported types (59)
```

None of the 130 is a broken build; almost all are a single word, `export` in
front of something only its own file calls. `generateToken` in
`lib/auth/index.ts:114` is the shape of it — exported, and referenced once,
twelve lines further down.

That collides with the Work section's step 2, "get it to zero on today's
tree". Getting *exports* to zero means 130 small edits, and this task's own
Not-doing says deleting is a separate task per finding. Both cannot hold. The
resolution taken, rather than quietly dropping either: the rules that **are**
at zero are set to `error` and fail CI, and `exports`/`types` are set to `warn`
— printed every run, failing nothing — with the cleanup captured as **B235**.
The step-2 instinct is right and is honoured where it can be: nothing that
fails today starts life with a backlog of findings.

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
  → `npm run unused`. **Files, dependencies, unlisted imports and unlisted
  binaries are at zero and are `error`.** Unused exports and exported types are
  reported and are `warn`; there are 130 of them, they are all real, and they
  are B235. See the correction above for why the acceptance could not be met as
  written.
- Its entry-point configuration covers `app/` routes, `instrumentation.ts`,
  `proxy.ts`, `public/sw.js`, `scripts/*` and `test/*`.
  → `knip.jsonc`. `app/` comes from knip's Next.js plugin; the rest are listed
  by hand, plus `.claude/skills/**/*.mjs` (a skill's own tooling) and
  `lib/db/migrations/[0-9]*.ts` (imported as namespaces and handed to Kysely
  whole, so nothing statically names `up` or `down`).
- Where it belongs in the verification routine is written down.
  → **Not one of the four**, and `AGENTS.md` says so in the "Verifying a
  change" section: it is CI's job, as its own `unused` job in
  `.github/workflows/ci.yml`, because the answer changes rarely and the day it
  changes is a day nobody was looking. A person runs it when they delete a
  module or drop a dependency. It takes under a second on files and
  dependencies.

## What was built

- `knip` as a devDependency (15 packages, 5.3 MB) and `npm run unused`.
- `knip.jsonc`, which is mostly entry points and mostly comments — nearly
  nothing in this repository is imported by name, and a tool that does not know
  that reports the application as dead code, which is how a check earns being
  ignored.
- An `unused` job in CI, alongside `lint`, `typecheck` and `test`.
- **B235**, for the 130 unused exports and exported types, with the plan to
  move each rule from `warn` to `error` as its group is cleared.

Nothing was deleted, per the Not-doing.
