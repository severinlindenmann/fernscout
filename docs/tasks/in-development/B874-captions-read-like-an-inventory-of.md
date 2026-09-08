---
id: B874
title: Captions read like an inventory of shapes rather than a caption
type: ISSUE
priority: low
complexity: low
area: agent, model
found: "2026-09-07T17:37:28Z"
started: "2026-09-08T20:33:50Z"
session: bdd0270d-3797-42c9-8687-06abecadbc63
claimed: "2026-09-08T20:33:50Z"
---

# B874 — Captions read like an inventory of shapes rather than a caption

## Why

The captions are honest and unlovely. From the audit:

> `"Tall pointed structure against a light blue sky, with a red informational
> panel on the left and green shape at the bottom"`

Every honesty rule held — no place, no person, no mood, nothing invented, under
a picture built specifically to bait all three. The register is the problem: it
reads as a machine enumerating rectangles and their positions, not as something
a person would write under their own photograph.

The auditor traced it to one line of `PHOTO_SYSTEM_PROMPT`:

> A plain caption of what is actually in the frame — **the colours, the
> setting, the action** — beats a caption that reaches for any of that

That list is an invitation to inventory. Its proposed replacement:

> A plain caption of what is actually in the frame beats a caption that reaches
> for any of that. Write it as somebody would label their own photograph — a
> handful of words naming the subject, not an inventory of every shape and its
> position in the frame.

## Work

Change the register only. **Do not touch the honesty rules** — they were tested
hard and held, and they are the reason this feature can exist at all.

Then re-run the audit's own fixtures against the live model, because B829
established that rewording a prompt is not a change until it is measured.

## Acceptance

A caption reads like a label somebody wrote, and still names no place, no
person and no mood.

## Found still real, and what changed

Confirmed against the code on 2026-09-08: `photoSystemPrompt()` in
`lib/helper/model.ts` still carried the exact sentence quoted above,
word for word. No sibling ticket covers this (searched `docs/tasks/` for
"caption" and "inventory of shapes" — the closest are B687, completed,
which is about photographs describing *themselves* rather than register,
and B734, completed, about caption language, not tone).

Changed only the one sentence, exactly to the ticket's proposed
replacement, leaving every honesty clause (`DESCRIBE ONLY WHAT IS
VISIBLE`, "do not name a place", "never identify a person", "never guess
a mood") untouched. Added a regression test in
`test/helper-describe-photos.test.ts` (`"asks for a label, not an
inventory of shapes"`) asserting the prompt contains the new "not an
inventory of every shape" phrase and no longer contains "the colours,
the setting, the action" — confirmed failing against the old prompt
(`git stash` of `lib/helper/model.ts` alone) and passing after.

**Not done: re-running the audit's fixtures against the live model.**
This worktree has no `ANTHROPIC_API_KEY` configured, so no network call
to the real vision model was possible from here. `describePhotos` is
stubbed in every test that exercises it (by design, per that file's own
comment — "what a vision model actually says is not assertable"), so the
only way to see whether the reworded prompt actually changes the
register of a real caption is a person, or an agent holding a real key,
running the audit's own fixture photographs through
`describePhotos()` directly and reading the captions back. That is the
one Acceptance line this session could not close — reported rather than
guessed at.
