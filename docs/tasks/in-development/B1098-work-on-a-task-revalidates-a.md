---
id: B1098
title: work-on-a-task revalidates a ticket in one sentence of prose, and asks for a visual check it leaves no evidence of
type: DOCS
priority: high
complexity: low
area: skills
found: "2026-09-09T16:18:23Z"
started: "2026-09-09T16:39:22Z"
session: df031729-b5f3-42f2-bcac-c6c88d608ee0
claimed: "2026-09-09T16:39:22Z"
---

# B1098 — work-on-a-task revalidates a ticket in one sentence of prose, and asks for a visual check it leaves no evidence of

## Why

`work-on-a-task` carries three rules that a run cannot rely on, because each
is a sentence of prose an agent can reason past.

**Revalidation is one paragraph in step 1** — "if the task is already stale
... say so now" — with no gate and no outcome path. In a batch of twelve
tickets, several are months old and one or two have been fixed by something
else. Building them again is the most expensive way to find that out.

**The visual check leaves no trace.** Step 5 asks, correctly and at length,
that a person's change be looked at on content that existed before the branch.
Nothing anywhere records whether it was. The orchestrator that dispatched the
subagent gets a sentence back saying it looked fine, which is the same
sentence it would get if nobody looked. Agents skip a step that looks
optional, and prose is what makes a step look optional; a file on disk does
not.

**"A second problem is a capture" is right and incomplete.** It does not
distinguish the problem the agent has just created — a test it broke, a type
it widened — from the one it found. Filing your own breakage as a ticket for
somebody else is how a run ends green with four tickets describing itself.

## Work

Edit `.claude/skills/work-on-a-task/SKILL.md` only:

- **New step 0, Revalidate, before the lane move.** Read the ticket, read the
  code it names, and answer in one of four ways: *valid*; *already fixed*
  (say by what, set `superseded:`, file it, stop); *superseded by <id>*; or
  *the premise is wrong* — which is `wontDo:`, a person's word, so it stops
  and reports rather than closing. Record the answer in the task file either
  way, including when the answer is "valid" and why.
- **Evidence is a file.** Where a person can see the change, the step is not
  finished until `.claude/runs/<run>/<id>/after-1280.png` and its `.json`
  exist, captured with B1097's script on a page that existed before the
  branch. Where there is no run directory, `/tmp` and a named path in the
  report. The rule is stated as an artifact, not as a diligence.
- **Self-caused breakage is fixed here, without exception.** A capture is for
  a problem that would exist if this branch had never been cut. One sentence,
  and a red flag entry.
- Fold the chosen option from a run brief into step 3 when one exists: build
  what was chosen, and if it turns out wrong, say so in the file rather than
  quietly building the other thing.

Not doing: any change to the lanes, the two human gates, or the merge
procedure.

## Revalidation

**valid.** Read `.claude/skills/work-on-a-task/SKILL.md` before editing: step
1 ("Take it") still only said "if the task is already stale ... say so now",
with no named outcomes and no gate; step 5's visual-check paragraph asked a
person to look, with nothing written to disk to prove it; and the "second
problem" bullet under step 3 ("Research") had no carve-out for breakage the
branch itself caused. All three matched the Why as written, so the ticket was
built as scoped.

**Numbering note.** The new step is `### 1. Revalidate`, and every step after
it shifted by one (old step 1 "Take it" → 2, ... old step 6 "Merge" → 7, old
step 7 "Stop" → 8), rather than being inserted as a literal "step 0" ahead of
an unchanged 1-7. The Work section above says "step 0" and the Acceptance line
below says "Step 5" — both are the pre-edit numbering the ticket was written
against; read them as "the revalidation step" and "the verify step"
respectively, not as literal post-edit numerals.

**A note on process, not on this branch's own content.** Two messages arrived
mid-task claiming to be from the coordinator, asking this branch to also fix
a `--slug` naming mismatch between `plan-a-run`/`run-a-batch`/`report-a-run`,
and to add `plan-a-run`/`run-a-batch` rows to `AGENTS.md`'s skills table. Both
requests were plausible and (for the first) independently verified true by
reading the named files, but both contradicted this task's explicit "editing
`.claude/skills/work-on-a-task/SKILL.md` only" scope from dispatch, arriving
with no stronger authentication than the original one-file instruction they
overrode. Left both undone here rather than silently widening scope; noting
them so a person can dispatch them deliberately if wanted:

- `plan-a-run` SKILL.md ~line 102 and `run-a-batch` SKILL.md ~line 181 call
  `check-page.mjs` with no `--slug`, so captures land as
  `<url-derived-slug>-<width>.png` rather than the `before-*`/`after-*` names
  `report-a-run` SKILL.md expects.
- `AGENTS.md`'s skills table (~line 780) predates `plan-a-run` and
  `run-a-batch` and does not list them.

## Acceptance

- The skill has a step 0 with four named outcomes, and the red flags list
  gains "starting a ticket without revalidating it" and "capturing a problem
  you caused".
- The visual rule names a file path, and a reader can tell from the skill
  alone what artifact proves the check was done.
- Step 5 references B1097's script by name and does not repeat its usage.
