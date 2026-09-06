---
id: B577
title: selftest.mjs exits 0 having tested nothing, because its fixtures are gitignored
type: ISSUE
priority: high
complexity: low
area: fernscout-helper, selftest, fixtures
found: "2026-09-06T14:05:00Z"
---

# B577 — selftest.mjs exits 0 having tested nothing, because its fixtures are gitignored

## Why

Found on 2026-09-06 while looking for a way to verify B572, B573 and B574.

`fernscout-helper`'s `AGENTS.md` presents `shared/selftest.mjs` as the guard
against the drift that has already happened once — the site gaining
`unrecorded: [costs]` while the validator did not know the key, and a good
journal coming back with two errors, both wrong. It says: **"Run it after the
site is deployed with anything new, and when a validation message looks
wrong."**

On a clean clone it does this:

    $ node .claude/skills/shared/selftest.mjs
    — perfekt: not here, skipped
    — halbfertig: not here, skipped
    — luecken: not here, skipped
    $ echo $?
    0

All three fixtures are addressed as `content/<user>` (`selftest.mjs:31-35`),
and `/content/` is the second line of `.gitignore` — correctly, because that
is where a person's real journal and photographs go. So the three journals
committed as "Three fixture journals, and the tips a settled question should
not raise" exist only on the machine that wrote them. `git log -- content/`
is empty.

The failure is not that the fixtures are missing. It is that **missing reads
as passing**: the skip is not an error, the exit code is 0, and nothing in the
output says the run proved nothing. An agent following `AGENTS.md` runs it,
sees no failure, and reports the tools as agreeing with the instance.

That is worse than having no self-test. `luecken` exists specifically to fail
— "a validator that stops noticing is the other way this rots" — and a
validator that has stopped noticing everything currently produces a green run.

Blocks the acceptance line "selftest.mjs still passes" on B573, which cannot
mean anything until this is fixed.

## Work

- Move the three fixture journals somewhere committed. `content/` cannot hold
  them; the ignore rule is right and protects somebody's photographs. A
  `fixtures/` directory beside `.claude/skills/shared/` is the obvious home,
  with `selftest.mjs` pointing `--user` at it. Whatever the location, it has to
  be one where `git status` shows a change to a fixture.
- Rebuild the three journals to what `selftest.mjs` already asserts about
  them: `perfekt` every option set and clean, `halbfertig` valid and
  incomplete and clean, `luecken` at least twelve planted faults, one of each
  kind. The expectations in `EXPECTED` are the specification; they survived and
  the content did not.
- Make a missing fixture **fail**, loudly, with a non-zero exit. A skip that
  cannot be distinguished from a pass is the whole finding here.
- Include the photographs the galleries reference, or the checks that read
  files off disk are skipped too — those are the half of the validator no
  server can do. Placeholder images, generated, not anybody's.
- `AGENTS.md` names `content/` as where the three journals live. Correct it.

Not doing: turning this into a test runner. One script, one exit code.

## Acceptance

- On a fresh clone, with no `content/` at all, `node
  .claude/skills/shared/selftest.mjs` runs all three fixtures and exits 0.
- Deleting a fixture directory makes the run exit non-zero with a message
  naming what is missing — a test that asserts this, since the bug is that the
  absent case looked fine.
- Reverting the `unrecorded:` support in `shared/model.mjs` makes the run fail
  on `perfekt`, demonstrating it catches the drift it was written for.
- `git status` is dirty after editing a fixture journal.
