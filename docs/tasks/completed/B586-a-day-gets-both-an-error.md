---
id: B586
title: A day gets both an error and a tip for the same unanswered question
type: ISSUE
priority: low
complexity: low
area: fernscout-helper, validate-content, tips
found: "2026-09-06T14:17:37Z"
started: "2026-09-06T18:00:11Z"
merged: "2026-09-06T18:12:34Z"
completed: "2026-09-07T13:12:15Z"
---

# B586 — A day gets both an error and a tip for the same unanswered question

## Why

Noticed on 2026-09-06 while verifying B581.

A day that says nothing about a tracked field gets two findings for the one
omission:

    ✗ the trip tracks photos and this day says nothing about it
    · has no photographs

The error and the tip are the same observation at two severities. The tip adds
nothing the error has not already said more urgently, and the reader has to
work out that the second line is not a second problem.

`validate.mjs` already has the machinery to prevent this: a tip is dropped when
an error was recorded for the same `where|key` pair. It does not fire here
because these `tip()` calls pass no `key` for the dedup to match on, so the
error and the tip are never recognised as being about the same thing.

The same shape applies to `costs` and `coordinates`, which share the mechanism
and likewise pass no key.

Small, and not wrong in the way an incorrect finding is wrong. It matters
because `SKILL.md` is explicit that a tip is an offer and that the tips are to
be read out to a person as choices — and a list where some entries are echoes
of the errors above them is one people learn to skim. B581 was the same
principle a step earlier: do not raise a question that has been answered. This
is: do not raise it twice.

## Work

- Give the three tips a `key` matching the error's, so the existing dedup
  applies. Prefer this over a new suppression rule — the mechanism exists and
  a second one would be the thing that drifts.
- Check the other `tip()` calls for the same omission while in there; report
  what was found rather than fixing beyond the three if it turns out to be
  wider.

Not doing: changing which findings are raised, or their severities. Only
whether the same one is printed twice.

## Acceptance

- A day silent about photographs produces the error and no "has no
  photographs" tip.
- A day with an empty gallery on a trip that does not track photographs still
  produces the tip — the tip is not simply removed.
- The equivalents for `costs` and `coordinates` behave the same way.
- `selftest.mjs` still passes, with `halbfertig` at 0 errors and 0 warnings.

---

## Corrected while building, 2026-09-06

Two things this ticket asserted turned out to be wrong, and the fix was
narrower than it claimed.

**`costs` and `coordinates` already deduped.** The ticket said all three tips
pass no key. In fact those two are raised by the generic `checkKeys()` loop
(`validate.mjs:147`), which passes the field's own key automatically because
their `MODEL` entries carry a `tip:`. Verified against a fixture: a day silent
about costs already got the error and no tip, before any change. Only the
hand-written "has no photographs" tip lacked a key. One line, not three.

**The second acceptance line described behaviour that does not exist.** It
asked that "a day with an empty gallery on a trip that does not track
photographs still produces the tip". The tip's own guard is
`tracks.photos !== false`, so it has never fired for a trip that turned the
track off — deliberately, and unchanged by this work. The line was written from
the ticket author's assumption rather than from the code, and it was right to
flag it rather than change working behaviour to satisfy it.

Recorded because a task file is the working record: the next reader should not
re-derive that the other two tips were fine all along.
