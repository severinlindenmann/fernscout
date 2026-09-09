---
id: B1014
title: The embedded print fonts are read from the process's working directory, so npm run postcard fails outside the checkout
type: ISSUE
priority: high
complexity: low
area: Print
superseded: "Fixed in eb0e71c0 by the session that introduced it — the faces are found from the module now, not from the caller's working directory."
found: "2026-09-08T18:50:00Z"
---

# B1014 — The embedded print fonts are read from the process's working directory, so npm run postcard fails outside the checkout

## Why

`lib/postcard/pdf.ts:192` reads a face with

```ts
fs.readFileSync(path.join(process.cwd(), "lib", "print-fonts", file))
```

`process.cwd()` is wherever the *process* was started, not where the code
lives. `npm run postcard` is a CLI a person runs from their own directory, and
from anywhere but the checkout it dies:

```
ENOENT: no such file or directory, open '/private/tmp/pcgen/lib/print-fonts/LiberationSans-Regular.ttf'
    at PdfBuilder.build (lib/postcard/pdf.ts:488)
    at renderPostcard (lib/postcard/render.ts:395)
```

**`main` is red on it.** `test/generator-output.test.ts` — "with CONTENT_DIR
unset it still writes to `<cwd>/content`" — runs the generator from a scratch
directory precisely to prove the default, and it now exits 1. Found running
`npm run verify` on `main` straight after merging B1010, which was green in its
own worktree; `git log` puts the cause in the `pdfx4` merge (503ca858) that
landed on top, and neither branch had it alone. Not the other session's fault
in any interesting sense — it is the one shape of path bug that a checkout-only
test run cannot see.

The same read is on the photobook's path, so the hazard is not limited to
postcards; anything invoking a renderer from a working directory that is not
the repository root gets it.

## What happened

Already fixed by the time this was picked up: `eb0e71c0`, "Find the print
faces beside the writer, not beside the caller", resolves the file from
`import.meta.url`. Verified rather than rebuilt — `test/generator-output.test.ts`
passes, and `npm run postcard` run by hand from `/tmp` writes a card.

## Work

Resolve the font from the module rather than from the process:
`new URL("../print-fonts/…", import.meta.url)` or a `path.join(__dirname, …)`
equivalent, whichever the build tolerates in both the Next bundle and under
`tsx`. Check it in both: the bundler and the CLI resolve module URLs
differently, and this file is reached from both.

Not doing: moving the fonts, or teaching the CLI to hunt for a checkout root.
The file's location relative to the module is the fact that is actually stable.

## Acceptance

- `npx vitest run test/generator-output.test.ts` passes on `main`.
- `npm run postcard -- …` writes a card when run from `/tmp`.
- `npm run verify` is green on `main`.
