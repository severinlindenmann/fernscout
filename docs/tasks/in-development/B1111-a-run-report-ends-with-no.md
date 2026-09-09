---
id: B1111
title: A run report ends with no way to say which tickets a person accepted
type: DOCS
priority: high
complexity: low
area: skills
found: "2026-09-09T16:48:23Z"
started: "2026-09-09T16:53:34Z"
session: df031729-b5f3-42f2-bcac-c6c88d608ee0
claimed: "2026-09-09T16:53:34Z"
---

# B1111 — A run report ends with no way to say which tickets a person accepted

## Why

`report-a-run` deliberately ends without a decision bar: "`triage-a-backlog`
ends in a choice; this ends in a handover, and buttons on finished work would
only invite a person to re-decide something already merged."

That was the wrong call, and the reason is the lane. A merged ticket sits in
`testing/` until a person has seen it working — that is the second of the two
human gates, and an agent never passes it. The report is exactly where a
person forms that opinion: it is the page with the before and the after on it.
Ending it with no way to record the answer means the person reads the page,
decides, and then has to go and compose the instruction by hand — or, far more
likely, does not, and the lane accumulates until somebody clears 284 of them
in one sentence, which is what happened here on 2026-09-09.

The buttons are not re-deciding merged work. They are the acceptance gate,
which is a person's and has never had a surface.

## Work

Give `report-a-run`'s artifact a closing selection, built on the same
machinery `triage-a-backlog`'s decision bar already uses (localStorage under a
versioned key, clipboard with an honest report of whether the write resolved,
a readonly textarea as the fallback, never a download):

- Every ticket row carries **accept / needs another look**, nothing
  pre-selected, and the tally in the sticky bar counts the undecided.
- **Every ticket row also carries a note field**, on both verdicts, and
  whatever is typed there is carried into the generated text beside its id.
  That is the half that makes the page worth filling in: "accepted, but the
  spacing at 390 is tight" is a sentence the next agent can act on, and it is
  lost entirely if the only output is a list of ids. An empty note contributes
  nothing — no blank bullet, no placeholder.
- "Build the list" writes a paste-ready instruction as its first line —
  `move B1097 B1099 B1100 to completed` — then the accepted tickets that
  carry a note, then the tickets held back with theirs.
- The closing box ("what still wants your eyes") stays exactly as it is. It is
  the thing the person reads *before* pressing the buttons.

Not doing: letting the report move a task file itself. `completed/` is a
person's gate; the deliverable is still text in their clipboard.

## Acceptance

- The artifact's clipboard block starts with a line an agent can act on with
  nothing added.
- A ticket the person marked "needs another look" appears below that line with
  its note, and is not in the move list.
- A note typed against an accepted ticket survives into the clipboard text; a
  ticket with no note adds no line.
- The skill still says, in words, that the report does not move anything.

## Notes

Validity of this ticket was established by the owner in the session that
captured it (df031729-b5f3-42f2-bcac-c6c88d608ee0); not re-litigated here.

Built as a single edit to `.claude/skills/report-a-run/SKILL.md` in worktree
`b1111-report-gate`. It is a prose/skill change — there is no artifact HTML to
run, so "acceptance" here is that the skill's own instructions, followed by
whoever runs `report-a-run` next, produce those four behaviours. Evidence:

- **Clipboard block's first line is paste-ready.** New Step 6 ("the
  acceptance gate") specifies: "*Build the list* writes a markdown block that
  starts with one paste-ready line — `move B1097 B1099 B1100 to completed`,
  the accepted ids, in order, nothing else."
- **A held-back ticket appears with its note, not in the move list.** Step 6:
  "Below that line: the accepted tickets that carry a note, each with its
  note; then the tickets held back, each with theirs" — held-back tickets are
  listed separately from, and after, the `move … to completed` line, which
  names only accepted ids.
- **A note on an accepted ticket survives; an empty note adds nothing.** Step
  6: "Whatever is typed there is carried into the generated text beside that
  ticket's id … An empty note contributes nothing to the output — no blank
  bullet, no placeholder line."
- **The skill still says the report moves nothing.** Step 6's closing
  paragraph: "This still moves nothing. `completed/` is a person's gate,
  exactly as `open/` is in `triage-a-backlog`, and the deliverable is text in
  a clipboard … Neither this page nor the run that produced it touches a task
  file." Step 7 ("hand it over") was also updated to keep this: "Do not move
  anything to `completed/` yourself — that is still the person's gate; the
  page above only gives them the words to do it with."

The old "No decision bar" paragraph (previously at the end of Step 4) was
replaced rather than kept alongside the new reasoning, per the prompt's
instruction that a skill arguing both ways is worse than either.

`npm run verify` (full, not `--quick`) passed: 470 test files, 6331 passed / 4
skipped, `npm run unused` clean. No code was touched, so this mainly confirms
the edit didn't break anything else in the repo.

Nothing else was captured to `backlog/` — this was a single self-contained
skill edit with no code to audit beyond the one file.
