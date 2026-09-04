---
id: B23
title: Everything in docs was archived and nobody decided what is still current
type: CHORE
priority: low
complexity: low
area: docs
found: "2026-09-01"
started: "2026-09-04T05:58:30Z"
session: 2b6d1969-424a-4788-9497-eb5e151a5391
claimed: "2026-09-04T05:58:30Z"
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
