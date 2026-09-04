---
id: B09
title: Links to docs moved into archiv no longer resolve
type: CHORE
priority: medium
complexity: low
area: docs
found: "2026-09-01"
started: "2026-09-04T05:58:30Z"
session: 2b6d1969-424a-4788-9497-eb5e151a5391
claimed: "2026-09-04T05:58:30Z"
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

---

## Resolution — 2026-09-04

**B09 carries the fix for all three captures of this.** B62 and B198 are the
same finding, reported independently on 2026-09-01 and 2026-09-03; both are
resolved by this work and say so in their own files. B23 is the decision this
depended on and was done first.

The links were not repointed. **The files were moved back**, which is B23's
answer: `docs/archiv/` was created to mean *nobody has reviewed this*, and that
is a fact about provenance, not about currency. The repository never agreed
that the files had moved — thirty-odd citations in `lib/`, `scripts/`, `test/`,
`.github/` and `.claude/skills/` still named `docs/runbook.md`,
`docs/providers/…`, `docs/ingest.md` and `docs/config-upgrades.md`, and the
three that *had* been repointed into `archiv/` ended up telling an operator
that the live backup procedure was archived. Moving the files back fixed
twenty-five citations without touching a line of code.

What changed:

- Eleven paths out of `docs/archiv/` and back to `docs/`: `ROADMAP.md`,
  `TESTING.md`, `architecture.md`, `config-upgrades.md`, `currencies.md`,
  `deploy-mail.md`, `ingest.md`, `runbook.md`, `running-locally.md`,
  `providers/`, `qa/`. `docs/archiv/` no longer exists.
- `docs/archiv/AGENTS.md` became `docs/README.md`. The unreviewed-provenance
  warning it carried is kept verbatim in substance — it was the useful half —
  without the directory name that misstated it.
- `docs/plans/` restored from `e576105^`, 37 files. This is the second half of
  the Work above, and the answer is *restore*, not *inline*. Ten citations in
  `lib/`, `test/`, `CONTRIBUTING.md`, `docs/ROADMAP.md` and
  `.github/workflows/ci.yml` name a plan as the reasoning behind a decision,
  and `.claude/skills/manage-tasks/SKILL.md` — maintained guidance, not
  archive — still instructs agents to *write* plans into `docs/plans/` and
  never move one out. A workflow that names a directory which does not exist
  is broken guidance, and paraphrasing eight comments would have thrown away
  the reasoning they deliberately delegated.
- `lib/agentConfirm.ts:35` cited `docs/plans/W28` — a prefix, not a file. Now
  `docs/plans/W28-agent-safety-gates.md`.
- Five citations of `docs/archiv/runbook.md` repointed to `docs/runbook.md`:
  `lib/backupStatus.ts:117`, `scripts/sync-shipped-content.sh:35,59`,
  `test/backup-script.test.ts:20,241`.

**This reverses part of `e576105`, which removed `docs/plans/` deliberately
rather than archiving it.** That is a person's decision being undone by an
agent, so it is stated here rather than buried: if the intent was that plans
live only in git history, the ten citations that name them have to be rewritten
instead, and this commit should be reverted. The evidence for restoring is
above; the choice is the reviewer's.

Task files under `docs/tasks/` were not repointed. They are the record of what
was true when they were written, and several of them cite `docs/archiv/…`
correctly for that moment.

## Acceptance — met

```
$ grep -rhoE 'docs/[A-Za-z0-9._/-]+' README.md AGENTS.md CONTRIBUTING.md \
    .claude/skills/*/SKILL.md lib app scripts test deploy .github \
  | sed 's/[.,)`"]*$//' | sort -u \
  | while read p; do [ -e "$p" ] || echo "BROKEN  $p"; done
(no output)
```

`test/docs-links.test.ts` is new and makes both halves of this a build failure
rather than a thing somebody notices. One test per markdown file — `README.md`,
`AGENTS.md`, `CONTRIBUTING.md`, everything under `docs/` and every skill —
asserting that its relative links resolve; plus one sweep asserting that every
`docs/…` path cited from `lib/`, `app/`, `scripts/`, `test/`, `deploy/`,
`.github/` or a skill exists. Demonstrated by appending a link to a file that
does not exist to `README.md`: two tests fail, one naming the link and one
naming the file that cites it. Removing it turns them green.

`docs/tasks/` and `docs/plans/` are excluded from the first test, with the
reason in the test's own comment: a task file quotes the broken link it is
reporting, and a plan is intent written before the work and never corrected.
The exclusion earned itself immediately — the first full run failed on the
resolution note in B198, which quotes the demonstration above.
