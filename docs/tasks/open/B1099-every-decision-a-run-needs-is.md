---
id: B1099
title: Every decision a run needs is asked mid-run, so a batch cannot be started and left alone
type: DOCS
priority: high
complexity: high
area: skills
found: "2026-09-09T16:18:24Z"
---

# B1099 — Every decision a run needs is asked mid-run, so a batch cannot be started and left alone

## Why

A batch cannot be started and left alone, because the questions arrive while
it runs. Which of two layouts, whether a wording change is worth it, what the
"before" even looked like — each stops the run until a person answers, and a
run that stops every twenty minutes is a run somebody is babysitting.

The decisions are knowable in advance. What is missing is a step that gathers
them all, presents them together, and turns the answers into something a build
can read.

This is also where the outside evidence is most one-sided. The recorded
failure of spec-driven work in 2026 is teams keeping all their review at the
final diff: the spec and plan gates are what catch defects before code exists,
and skipping them turns the method into overhead. The matching retrospective
failure is a reviewer who knew the task but not the plan, and passed work that
built infrastructure it never integrated. Both say the same thing — the
decision must be made early and must travel with the ticket.

`triage-a-backlog` is close but is the wrong end: it sorts tickets nobody has
started and hands back a decision list. It does not look at the code, does not
capture what a page looks like today, and does not offer a choice between two
ways of doing the work.

## Work

A new skill, `.claude/skills/plan-a-run/SKILL.md`. Input: a list of ids.
Output: one artifact, and `.claude/runs/<run-id>/brief.json`.

Per ticket, in parallel subagents on Sonnet:

1. **Revalidate against the code** — the same four answers as B1098's step 0.
   A ticket that is already fixed never reaches the artifact except as a row
   saying so.
2. **Conflict check** — is another session holding it, is it in the right
   lane, does a sibling worktree already touch those files.
3. **Capture the before** — for anything visible, B1097's script against the
   live site or a local checkout; for a bug, the reproduction actually run,
   with its wrong output quoted. A ticket with no before-state is flagged, not
   guessed at.
4. **Options, where there is a choice** — two or three, each a *different
   stance* on the question rather than different pixel values, drawn as
   throwaway HTML. Two options that differ only in an accent colour are wasted
   effort and are worse than one option with a stated reason.
5. **Questions with a recommended default**, so the artifact is answerable by
   tapping rather than by thinking.

The artifact reuses `triage-a-backlog`'s decision-bar machinery and this
repository's palette. Its "build the list" writes the brief: per ticket the
chosen option (including the chosen mockup's HTML, kept verbatim so the
implementer works from it rather than from a summary of it), the answers, the
grouping, and every ticket dropped with the reason.

Not doing: building anything, moving a task file, or promoting into `open/` —
this skill ends with the person's answer, and B1100 is what consumes it.

## Acceptance

- Run over three real backlog ids and it produces an artifact with, for each:
  a validity verdict grounded in a file it read, a before-state or an explicit
  flag that there is none, and either options or a stated reason there is only
  one.
- Answering the artifact writes a `brief.json` that names every ticket, the
  chosen option, and the grouping — and a second agent handed only that file
  can say what it is meant to build.
- A ticket whose code shows it is already fixed appears as a dropped row with
  the file and line that shows it, and does not appear in the brief.
- No task file moved.
