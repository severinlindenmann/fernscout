---
id: B243
title: npm run postcard prints four lines of Node module-type warning before its own first line
type: ISSUE
priority: low
complexity: low
area: postcards, scripts
found: "2026-09-04T08:32:06Z"
related: B238
---

# B243 — npm run postcard prints four lines of Node module-type warning before its own first line

## Why

Noticed while running the script repeatedly for B219 and B218.

`package.json` runs it as `node scripts/postcard.ts` — Node strips the types
itself, no `tsx` — and because the package has no `"type"`, every single run
opens with:

```
(node:90196) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of
file:///…/scripts/postcard.ts is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a
performance overhead.
To eliminate this warning, add "type": "module" to …/package.json.
```

Four lines of stderr before "Rendering 2 postcard(s)". Nothing is broken and
nothing is slow enough to notice. The cost is that the script's own output
starts below a wall of warning text, in a pipeline whose whole design is that
a person reads what it printed and checks it against the folder before paying
a printer — and that a warning nobody can act on is a warning everybody learns
to scroll past, including the next one that matters.

Every other script here runs through `tsx`, which does not warn.

## Related

Both are papercuts in the same two scripts, found in the same week and fixed
in the same place: `seed:example` writing beside the code rather than into
`contentRoot()` (B238), and `npm run postcard` opening with four lines of
Node warning (B243).

## Work

Decide which: run it through `tsx` like the rest, or set `"type": "module"` in
`package.json`. The second is the fix Node suggests and is a repository-wide
change with its own consequences — every `.js` in the repo becomes ESM — so it
is not obviously the smaller one. Whichever is chosen, say why in the commit.

**Not doing:** silencing it with `--no-warnings`, which would also hide the
warnings worth reading.

## Acceptance

- `npm run postcard -- --providers` prints its first line first.
