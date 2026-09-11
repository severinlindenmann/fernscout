---
id: B1052
title: Code and commits cite task ids that have no file, so the allocator hands them out again
type: CHORE
priority: low
complexity: low
area: tasks, ids
found: "2026-09-09T07:11:24Z"
started: "2026-09-11T14:52:01Z"
merged: "2026-09-11T15:19:27Z"
completed: "2026-09-11T19:13:08Z"
---

# B1052 — Code and commits cite task ids that have no file, so the allocator hands them out again

## Why

`app/api/helper/[user]/channels/route.ts:8` opens with *"The `channels` press —
B1051."* Commit `e722ee52` is titled *"B1051: invites, revoke_invite,
tell_readers and channels for the helper."* There is no `B1051` file anywhere
in `docs/tasks/`, and `git log --diff-filter=A -- "docs/tasks/**/B1051*"`
returns nothing — the file was never committed.

That is not merely untidy. `nextId()` allocates from what it can see, so on
2026-09-09 it offered **B1051** to a session capturing something unrelated. Had
that been taken, the code comment and the commit message would both have
pointed at a task about a different subject, permanently and with nothing
failing. AGENTS.md's own warning — *"a duplicate is permanent: two files
claiming one id have different filenames, merge cleanly, and render as two
happy rows"* — describes the near miss exactly.

The number is burnt now (the allocator reserved it in
`.git/fernscout-task-ids` before the file was removed, so the next `new` gave
B1052). What is left is the citation with nothing behind it, and the question
of how many more there are.

## Work

- Sweep for the general case: every `B<number>` cited in `lib/`, `app/`,
  `components/`, `scripts/`, `test/` and in commit subjects, against the ids
  that actually have files. Report the orphans; do not mass-edit.
- For B1051 specifically, a person decides between two endings: write the file
  it should always have had (the work is merged and would land in
  `completed/`), or correct the two citations to name the task that really
  covers that work.
- Consider whether `test/task-ids.test.ts` should read code comments as well
  as task files. Probably not — a stale comment is a one-line cost and a test
  that fails on prose is a test people learn to route around — but the ticket
  should say so rather than leave it unexamined.

Not doing: changing how ids are allocated. The allocator behaved correctly;
what failed was a file that was never committed.

## Acceptance

A list of every orphaned citation, and B1051 either has a file or is no longer
cited by one.

## Done

Wrote `docs/tasks/completed/B1051-invites-revoke-invite-tell-readers-and.md`,
read out of commit `e722ee52` and the ten sites that cite it
(`app/api/helper/[user]/invite/revoke/route.ts`, `.../day/tell-readers/route.ts`,
`.../channels/route.ts`, four comments in
`lib/helper/tools/areas/readers.ts`, `test/helper-readers.test.ts`, four in
`test/helper-thread.test.ts`). The work exists and is merged; the ending taken
is the one the ticket recommended — the record, not ten rewritten citations.

**Sweep** (`grep -rhoE '\bB[0-9]{2,4}\b' app lib components scripts test | sort -u`
against every id under `docs/tasks/`): one other orphan, `B431`, cited in
`app/layout.tsx:124`, `app/docs/api/page.tsx:77`, `components/LandingSections.tsx:497`
and `test/mobile-overflow.test.ts:6`. Same shape as B1051: `git log --all
--oneline --grep="B431"` shows a real commit (`26e40562`, "B431: the landing
page could be widened past the phone by one URL", merged in `ec8e1c7f`) and
no task file was ever committed for it. `test/task-ids.test.ts`'s "no task
refers in prose to an id that does not exist" check caught this one the
moment it was written into this ticket's own Done note (its regex is
`\bB\d{2,3}\b`, which does cover 3-digit ids like 431 — only a 4-digit id
such as B1051 slips past it), so B431 got the same ending as B1051 rather
than being left dangling: `docs/tasks/completed/B431-the-landing-page-could-be-widened.md`.

**On `test/task-ids.test.ts` reading code comments:** agree with the
ticket's own lean — not doing it. The "dangling reference" check there
already only matches 2–3 digit ids (`\bB\d{2,3}\b`), so it would not even
catch a 4-digit orphan like B1051 or B431 without also being rewritten, and a
test that fails on stale prose in a comment is a test people route around
rather than fix. Worth a separate, small capture on its own if the 2–3 digit
limit is itself now wrong (ids are 4 digits), but that is a different problem
from this ticket's.
