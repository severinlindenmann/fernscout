---
id: B1136
title: fernscout.ch carries test journals beside the two real ones, and nothing says which is which
type: OPS
priority: medium
complexity: low
area: ops, journals, live instance
found: "2026-09-09T18:27:05Z"
---

# B1136 — fernscout.ch carries test journals beside the two real ones, and nothing says which is which

## Why

Two journals on the live instance are real: `example`, the demo this project
ships and syncs, and `severin`, the owner's own. Every other journal there was
created to prove something worked — a signup flow, a persona round, a delete
drill — and none of it is content anybody lived.

They are not free. Each one holds disk under `content/`, appears in the
instance's own `/documentation.txt` and landing page unless its visibility says
otherwise, sits in `sitemap.xml`, occupies a name nobody else can take, and
shows up on `/admin` beside the two that carry real numbers — so every figure
an operator reads there is mixed with noise from journals nobody is keeping.
They also make every future engagement against the live site ambiguous: a
verifier looking for "a journal with no days" cannot tell a broken one from a
deliberate stub.

AGENTS.md already names the mechanism that should have prevented this: a
journal made for testing is created as `test-<something>`, because the
directory name is the one label that survives an export, a backup and an `ls`,
and it is what lets anybody delete the thing without stopping to find out whose
it is. The journals on the live instance predate that rule or ignored it.

Deleting is deliberately not something an agent can finish (B38): `DELETE` on a
journal answers `202` and mails the address in that journal's own `config.json`
a single-use link. So this is an OPS engagement — the deliverable is an
inventory, a decision per journal, and mails opened — not a diff.

## Work

- List every journal directory under `content/` on the live instance, with, for
  each: its `config.json` owner address, visibility, trip count, day count,
  total bytes, and when it was last written to. `/admin` already holds part of
  this; the rest is a directory listing over SSH.
- Set that list beside the two keepers (`example`, `severin`) and decide, per
  journal, one of: delete it, or rename it so its name says what it is.
  A journal that is still wanted for a recurring drill is worth keeping and
  worth renaming; one that proved a signup once is not.
- For each to go: `DELETE /api/v1/<user>`, then open the mail and press the
  button. Report the mails as waiting until they are actually pressed —
  a `202` is not a deletion.
- Check what each deletion leaves behind: `content/.deleted/<username>.json`
  keeps the name reserved and makes the old URLs answer 410, which is correct
  for a name somebody might reuse and wrong for a name nobody should hold.
  Decide per name whether to free it by removing the tombstone.
- Confirm afterwards that `/documentation.txt`, the landing page and
  `sitemap.xml` list only what should be there, and that `/admin`'s figures now
  describe the two real journals.
- Capture separately, do not fix here: anything found that let a test journal
  be created under a person-shaped name in the first place.

Not doing here: any change to signup, to the naming rule, or to the tombstone
mechanism. This is a clean-up of state, not of code.

## Acceptance

- A written inventory of every journal that was on the instance, with the
  decision taken for each.
- `content/` on the live instance holds `example`, `severin`, and nothing else
  except journals whose directory name says they are for testing.
- `/documentation.txt` and the landing page advertise only real journals.
- `/admin`'s balances and usage rows describe only journals somebody is
  keeping.
- No journal was deleted by reporting a `202`; each deletion names the mail
  that was opened.
