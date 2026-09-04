---
id: B62
title: Every docs/ link in the README points at a file that moved to docs/archiv
type: CHORE
priority: medium
complexity: low
area: docs
found: "2026-09-01"
started: "2026-09-04T05:58:29Z"
session: 2b6d1969-424a-4788-9497-eb5e151a5391
claimed: "2026-09-04T05:58:29Z"
---

# B62 — Every docs/ link in the README points at a file that moved to docs/archiv

## Why

`e576105` moved the prose docs to `docs/archiv/` and left every link to them
behind. `README.md` is the index the repository points newcomers at, and all
eleven of its `docs/…` links 404 on GitHub and on disk:

```
$ grep -oE "\(docs/[a-zA-Z0-9/._-]+\)" README.md | tr -d '()' \
    | while read f; do [ -e "$f" ] || echo "MISSING: $f"; done
MISSING: docs/running-locally.md   (twice)
MISSING: docs/runbook.md
MISSING: docs/architecture.md
MISSING: docs/ingest.md
MISSING: docs/currencies.md
MISSING: docs/config-upgrades.md
MISSING: docs/deploy-mail.md
MISSING: docs/providers/
MISSING: docs/TESTING.md
MISSING: docs/qa/
```

`.claude/skills/deploy/SKILL.md:10` sends an agent to `docs/runbook.md` for the
same reason and with the same result. `AGENTS.md` tells every agent that prose
about the software "is in `docs/`, indexed from the README", so the one path a
newcomer is told to follow is the broken one.

Found while working B56, which needed the runbook and had to guess where it
went.

## Work

- Fix the links, or move the docs back out of `archiv/`. Which of the two is a
  decision about whether `archiv/` means "superseded" or just "moved" — the
  directory currently holds the live runbook, so it appears to mean the latter,
  which is the confusing answer.
- A check that a relative link in a tracked markdown file resolves would stop
  this returning. `test/depersonalised.test.ts` is the precedent for a test
  that guards a documentation property.

## Acceptance

- Every `docs/…` link in `README.md` and in `.claude/skills/**` resolves to a
  file that exists.
- Something fails when one does not.
