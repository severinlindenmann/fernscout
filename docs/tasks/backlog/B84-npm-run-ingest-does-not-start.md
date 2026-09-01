---
id: B84
title: npm run ingest does not start, because a lib import omits the extension Node needs
type: ISSUE
priority: high
complexity: low
area: ingest, scripts, esm
found: "2026-09-01"
---

# B84 — npm run ingest does not start, because a lib import omits the extension Node needs

## Why

Found on 2026-09-01 while building **B77**, in a part of the tree that task
does not touch. Reproduced on `main` afterwards, with nothing stashed:

```
$ npm run ingest
Error [ERR_MODULE_NOT_FOUND]: Cannot find module
  '/Users/…/fernscout/lib/costFormat' imported from
  '/Users/…/fernscout/lib/validate/entry.ts'
  code: 'ERR_MODULE_NOT_FOUND'
```

`npm run ingest` is `node scripts/ingest.ts` — plain Node, not `tsx`, and
therefore Node's own ESM resolver, which does not add extensions. The chain
reaches `lib/validate/entry.ts:12`:

```ts
import { COST_CATEGORIES } from "../costFormat";
```

Next's bundler resolves that; Node does not. Neighbouring scripts avoid the
problem two different ways — `npm run photobook` and `npm run export` run under
`tsx --conditions=react-server`, and the modules `scripts/ingest.ts` reaches
directly do carry explicit `.ts` extensions. This one import does not, and it
is enough to stop the command before it does anything.

The cost is the whole of `ingest-photos`: pointing at an SD card and getting
dated, geotagged entries is one of the six skills in `.claude/skills/`, and the
entry point for it does not run. **The test suite never sees this** — the tests
import the ingest modules directly through Vitest, which resolves like the
bundler. So the four checks in AGENTS.md all pass on a command that cannot
start.

How long it has been broken is not established. It should be, since the answer
decides whether this is a regression or a path nobody has taken.

## Work

Add the extension. Then find out whether it is the only one: walk everything
`scripts/ingest.ts` reaches transitively and check each import against Node's
resolver, rather than fixing this one and rediscovering the next in the same
way.

The durable half is that nothing catches this class of breakage. Every
`node scripts/*.ts` entry point has the same exposure and the same blind spot,
because the suite resolves imports differently from the thing that runs in
production. A smoke test that executes each such script with `--help` or an
empty argument list, and asserts it reaches its own argument parsing rather
than a module error, would close it. Decide whether that belongs in `test/` or
in the deploy checks; it is fast either way.

Not in scope: converting `ingest` to `tsx`. That would work, but it treats the
symptom, and it makes one script's module resolution differ from its
neighbours' for no reason a reader could reconstruct.

## Acceptance

- `npm run ingest` reaches its own usage output or argument handling. It does
  not exit with `ERR_MODULE_NOT_FOUND`.
- The same holds for every other `node scripts/*.ts` entry in `package.json`.
- Something in the automated checks fails if a bare-extension import is
  reintroduced into that chain.
