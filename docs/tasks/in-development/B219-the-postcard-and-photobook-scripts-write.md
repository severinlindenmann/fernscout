---
id: B219
title: The postcard and photobook scripts write beside the code, not into the content root
type: ISSUE
priority: medium
complexity: low
area: postcards, photobook, scripts
found: "2026-09-04T06:40:18Z"
started: "2026-09-04T08:08:59Z"
session: 2b6d1969-424a-4788-9497-eb5e151a5391
claimed: "2026-09-04T08:08:59Z"
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

## Work

- Build both output directories from `contentRoot()`.
- Check the `--out` override in `scripts/photobook.ts` still means what it
  says once the default moves.
- While there: the same two scripts print progress as
  `path.relative(process.cwd(), …)`, which is a path a person can paste only
  while the two roots agree. Decide what a run should print when they do not.

**Not doing:** the plan JSON's own paths — B25 made those content-root
relative already, and this is about where the files land, not what is
recorded in them.

## Acceptance

- With `CONTENT_DIR` set to a directory outside the checkout, `npm run
  postcard` and `npm run photobook` write into it and leave no `content/`
  directory beside the code.
- The example journal still renders to the same place with `CONTENT_DIR`
  unset.
