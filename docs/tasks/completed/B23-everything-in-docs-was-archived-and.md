---
id: B23
title: Everything in docs was archived and nobody decided what is still current
type: CHORE
priority: low
complexity: low
area: docs
found: "2026-09-01"
started: "2026-09-04T05:58:30Z"
merged: "2026-09-04T06:22:16Z"
completed: "2026-09-04T07:21:29Z"
---

# B23 — What in `docs/` is still documentation

## Why

`docs/` now holds three things: `branding/`, `tasks/`, and `archiv/`. Sixteen
files moved into `archiv/` on 2026-09-01, and the move was a sweep rather than
a set of decisions — the whole directory went, not the parts that had stopped
being true.

Some of what is in there is plainly still live documentation and is being read
as archive:

| File | Still true? |
| --- | --- |
| `runbook.md` | Yes, and it holds the restore procedure B21 is about to execute |
| `currencies.md` | Yes — see B17, which asks for it back |
| `providers/mcp.md` | Yes, and `AGENTS.md` cites it as the MCP reference |
| `providers/photobook.md`, `providers/postcards.md` | Yes; the scripts cite them by name |
| `ingest.md` | Yes; `MEDIA_ORIGINALS_DIR` is documented nowhere else |
| `running-locally.md`, `config-upgrades.md`, `deploy-mail.md` | Probably |
| `TESTING.md`, `qa/` | Probably, if the walkthrough is still performed |
| `ROADMAP.md` | The decisions are cited constantly; the priorities are stale |
| `architecture.md`, `AGENTS.md` (the archived one) | Needs reading against the code |
| `superpowers/plans/2026-08-31-w37-…` | A plan. Plans do not move — see below |

Meanwhile the README's documentation table still links every one of them at
its old path (`README.md:116–124`), so following any row lands on nothing.

B09 is repointing those links, and it should not have to make this decision on
the way past. B09's question is "where does this link go"; this one's is
"should this file exist, and is it archive or is it documentation". Answering
the second badly makes the first pointless — a link repointed into `archiv/`
for something that is current tells every future reader it is historical.

## Work

1. Read each file in `docs/archiv/` against the code and sort it into: current
   documentation (move back out of `archiv/`), history worth keeping (leave),
   or wrong and superseded (delete — it is in git history).
2. Delete nothing that is still cited from code or a skill without replacing
   the citation. `grep -rn "docs/" lib app scripts .claude/skills` is the list.
3. `superpowers/plans/2026-08-31-w37-owner-and-guests.md` is a plan. The skill
   rule is that plans are the record of intent as written *before* the work and
   are deliberately not updated to match what shipped — so it does not get
   corrected and does not get moved out. Decide where plans live now (the
   directory they were in, `docs/plans/`, no longer exists) and put it there.
4. Then do B09, or do this as part of it. The order matters: sort first,
   repoint second.

The `docs/` house style is plain prose with the reasoning included. A file that
no longer has reasoning in it, only steps that are now wrong, is the one to
delete.

## Acceptance

- Every file in `docs/archiv/` has been read and placed deliberately.
- The README's documentation table resolves, and each row points at something
  that is actually current.
- Nothing in `lib/`, `app/`, `scripts/` or `.claude/skills/` cites a document
  that does not exist — the check in B09 prints nothing.
- The W37 plan is somewhere plans live, unedited.

---

## Resolution — 2026-09-04

Every file in `docs/archiv/` was read against the code and placed. The answer
turned out to be the same for all sixteen, which is worth stating plainly
because it is not the answer a three-way sort implies.

**`archiv/` was answering a question nobody was asking.** Its own `AGENTS.md`
said what it meant: *written by an agent during the build, never reviewed by a
person.* That is a fact about **provenance**. A directory called *archive* is
read as a fact about **currency** — historical, superseded, safe to ignore —
and not one of these files is that. The runbook holds the restore procedure
B21 executed. `providers/mcp.md` is what the root `AGENTS.md` cites as the MCP
reference. `config-upgrades.md` is the only place `configVersion` is explained.
The repository itself never accepted the move: thirty-odd citations in `lib/`,
`scripts/`, `test/`, `.github/` and `.claude/skills/` still named the old
paths, and the handful that had been dutifully repointed produced
`lib/backupStatus.ts` telling an operator that the backup procedure was in the
archive.

So the sort is: **all sixteen are current documentation and moved back to
`docs/`.** Nothing was deleted. The provenance warning is kept — it is the
useful half — as `docs/README.md`, which can say "nobody has verified these
claims" in the words that actually mean it, next to an index of what each file
is. Two files are flagged there as half-stale and kept for the half that is
not: `ROADMAP.md` (the decision log is durable and cited by number; the open
backlog below it is superseded by `docs/tasks/`) and `TESTING.md`/`qa/`
(accurate as far as anyone has walked them, which is not recently).

Spot-checks behind that, beyond the 117 path references the archive notice had
already resolved: `currencies.md` against `lib/rates.ts` (`site.manualRates`,
the ECB cache, the refusal to total an unrateable currency — all as described);
`config-upgrades.md` against `lib/configVersion.ts`, `lib/site.ts`
(`travellerNamesOf`) and `scripts/migrate-owner.ts`; `running-locally.md`
against `package.json` and `.github/workflows/ci.yml`. Nothing contradicted.

### Item 3 — the W37 plan, and a correction to this task

The Why said the plan sits in `superpowers/plans/` and that "the directory they
were in, `docs/plans/`, no longer exists". Both halves are right about a
different file. There were **two** W37 plans and two plan directories:
`docs/plans/W37-owner-and-guests.md`, the work-package plan, removed with the
other 36 in `e576105`; and `docs/superpowers/plans/2026-08-31-w37-owner-and-guests.md`,
written by the `superpowers` skill, which is the one that was swept into
`archiv/`. This task only saw the second.

Both now live in `docs/plans/`, unedited — the dated one keeps its name, so the
two do not collide and the reader can see they are two records of the same
work. `docs/plans/` is restored whole from `e576105^` (37 files, 128 KB); B09
carries the argument for restoring rather than inlining, and flags that it
reverses part of a deliberate decision.

## Acceptance — met

- Every file in `docs/archiv/` has been read and placed deliberately; the
  directory is gone.
- The README's documentation table resolves, and every row points at something
  current. `docs/README.md` says which two rows are half stale and why.
- `grep -rn "docs/" lib app scripts test deploy .github .claude/skills` cites
  nothing that does not exist — the check in B09 prints nothing, and
  `test/docs-links.test.ts` fails the build if that changes.
- The W37 plan is in `docs/plans/`, unedited.
