---
id: B1098
title: work-on-a-task revalidates a ticket in one sentence of prose, and asks for a visual check it leaves no evidence of
type: DOCS
priority: high
complexity: low
area: skills
found: "2026-09-09T16:18:23Z"
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

## Acceptance

- The skill has a step 0 with four named outcomes, and the red flags list
  gains "starting a ticket without revalidating it" and "capturing a problem
  you caused".
- The visual rule names a file path, and a reader can tell from the skill
  alone what artifact proves the check was done.
- Step 5 references B1097's script by name and does not repeat its usage.
