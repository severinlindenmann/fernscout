---
id: B09
title: Links to docs moved into archiv no longer resolve
type: CHORE
priority: medium
complexity: low
area: docs
found: "2026-09-01"
---

# B09 — Links into `docs/` no longer resolve

## Why

Most of `docs/` moved to `docs/archiv/` on 2026-09-01, and `docs/plans/` was
removed. About 27 references still point at the old paths, so following a link
from the README or a code comment now lands on nothing.

Counted at the time:

- **14** in `README.md`, the root `AGENTS.md` and `.claude/skills/*/SKILL.md`.
  This includes every row of the README's docs table — `running-locally.md`,
  `runbook.md`, `architecture.md`, `ingest.md`, `currencies.md`,
  `config-upgrades.md`, `deploy-mail.md`, `providers/`, `TESTING.md`, `qa/`.
- **13** in code and scripts — `next.config.ts`, `lib/db/`, `lib/contacts/`
  and others, mostly `docs/plans/W…` citations left as the explanation for why
  a piece of code is shaped the way it is.

The second group is the one that actually costs something. A comment saying
"see `docs/plans/W29-content-validation.md`" is carrying the reasoning for a
decision; when the file is gone the comment becomes a dead end, and the next
person reads it as folklore.

## Work

1. Repoint the surviving links at `docs/archiv/…`.
2. For the `docs/plans/W…` citations, decide once: either restore the plans
   (they are in git history — see `docs/archiv/AGENTS.md`) under
   `docs/archiv/plans/` and repoint, or inline the one sentence of reasoning
   each comment needed and drop the citation. Do not leave a link to a file
   that is not there.
3. Re-run the check that found this:

   ```bash
   grep -rhoE 'docs/[A-Za-z0-9._/-]+' README.md AGENTS.md .claude/skills/*/SKILL.md \
     lib app scripts test deploy | sed 's/[.,)`"]*$//' | sort -u \
     | while read p; do [ -e "$p" ] || echo "BROKEN  $p"; done
   ```

## Acceptance

- That command prints nothing.
- No comment cites a document that does not exist.
