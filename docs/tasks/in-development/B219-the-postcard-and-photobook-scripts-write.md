---
id: B219
title: The postcard and photobook scripts write beside the code, not into the content root
type: ISSUE
priority: medium
complexity: low
area: postcards, photobook, scripts
found: "2026-09-04T06:40:18Z"
started: "2026-09-04T08:20:02Z"
session: 7d30451d-0304-4631-8484-d96036fb11b4
claimed: "2026-09-04T08:20:02Z"
---

# B219 — The postcard and photobook scripts write beside the code

## Why

Noticed while building **B150**; the same shape as **B111**, which is why it
is filed rather than shrugged at.

Both generator scripts build their output directory from the working
directory:

```
scripts/postcard.ts:103   path.join(process.cwd(), "content", owner, "postcards")
scripts/photobook.ts:120  path.join(process.cwd(), "content", bookOwner, "photobooks")
```

`contentRoot()` (`lib/contentRoot.ts`) exists for exactly this and answers
`CONTENT_DIR` first. On a deployed instance the content root is under
`DATA_DIR` and the working directory is the code checkout, so a run of either
script on the server writes somebody's postal addresses — a rendered postcard
carries the recipient's home address, and the Stannp request JSON carries it
in plain text — into `/srv/fernscout/content/`, which is outside the backup
and inside the directory `git pull` runs in. That is B111's defect with a
different payload; B111's fix was to route every path `lib/mail` can write to
through `contentRoot()`, and these two were not part of it.

Nothing is broken locally, where the two paths are the same string, which is
why it has gone unnoticed. AGENTS.md already states the rule these violate:
"Nothing user-owned is written anywhere else."

The Why was read back against the code before anything changed, and it is
accurate line for line. Confirmed by running both scripts with `CONTENT_DIR`
pointed outside the checkout: both wrote into `content/` beside the code and
neither touched the content root.

## Work

- Build both output directories from `contentRoot()`. **Done** —
  `scripts/postcard.ts:110` and `scripts/photobook.ts:130`.
- Check the `--out` override in `scripts/photobook.ts` still means what it
  says once the default moves. **Done, and unchanged:** `--out` is still
  `path.resolve()`d against the working directory, which is what somebody
  typing a relative path means. Only the default moved. There is a test for
  it, because moving the default is exactly the change that would have
  quietly redirected an explicit `--out` too.
- While there: the same two scripts print progress as
  `path.relative(process.cwd(), …)`, which is a path a person can paste only
  while the two roots agree. Decide what a run should print when they do not.
  **Decided:** relative when the file really is under the working directory,
  absolute otherwise — `lib/displayPath.ts`. Never a ladder of `..`, which is
  true and useless, and reads as though the file had landed beside the code.
  Every path either script prints is now a path that finds the file, and there
  is a test asserting exactly that for both.

One thing the Why did not mention and which the fix improves: the photobook
preview HTML references its photographs as `path.relative(outDir, …)`
(`lib/photobook/preview.ts:218`). With the output folder inside the content
root those become `../trips/…` — short, and portable with the folder.

**Not doing:** the plan JSON's own paths — B25 made those content-root
relative already, and this is about where the files land, not what is
recorded in them.

**Found and captured, not absorbed:** `npm run seed:example` has the same
defect and creates a whole journal beside the code. That is **B238**.

## Acceptance

- With `CONTENT_DIR` set to a directory outside the checkout, `npm run
  postcard` and `npm run photobook` write into it and leave no `content/`
  directory beside the code.
- The example journal still renders to the same place with `CONTENT_DIR`
  unset.

Both are `test/generator-output.test.ts`, which runs the two scripts for real
against a content root outside the checkout — the bug is invisible unless the
two roots actually differ, which is the one condition no unit test of a helper
reproduces. Five of its ten tests fail against the code as it was.
