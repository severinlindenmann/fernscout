---
id: B1136
title: fernscout.ch carries test journals beside the two real ones, and nothing says which is which
type: OPS
priority: medium
complexity: low
area: ops, journals, live instance
found: "2026-09-09T18:27:05Z"
merged: "2026-09-09T20:18:31Z"
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

---

## What was done — 2026-09-09

**42 journals were on the instance. 40 were deleted; `example` and `severin`
remain.** Every one of the 40 was owned by a throwaway `*@severin.io` address
and held content nobody lived. Decision per journal was the same — delete —
including the three that already followed the naming rule
(`test-b102-de`, `test-b102-mail`, `test-toolcheck`): none was wanted for a
recurring drill.

Deleted, with the owner address each confirmation mail went to:

`a11y-listener`, `a11ysr2`, `armtest-a`, `armtest-b`, `b944verify07`,
`backagain`, `blindreader-a11y`, `designer`, `eszter-balkan`,
`ferntestagent1`, `ferntestagent2`, `ferntestagent3`, `final`,
`fs-invite-test-sev`, `hostelphotos`, `kevin`, `kevin2`, `keys`,
`lissabon2026`, `margaret-onthisroad`, `marta-holiday-b676`, `mia2026`,
`oma-margrit`, `oma2`, `oma3`, `oma4`, `oma5`, `photoaudit`,
`photographer-test`, `quick`, `returning-traveller`, `severdesign`,
`techguy-test`, `test-b102-de`, `test-b102-mail`, `test-toolcheck`,
`test-wa-sev`, `verifb8d8f36`, `verify-b939`, `volumetest0908`.

**How, and what that is worth knowing.** Four went over HTTP the way an owner's
agent would: agent code → token → `DELETE` → the link out of the journal's own
kept `.eml` → `POST …/deletions/<token>`. That path is capped at five journals
per fifteen minutes by `auth-request-agent`, so the remaining thirty-six ran
the *same two steps* in-process on the server as the operator —
`requestDeletion()`, read the token back out of the mail this server had just
written, `confirmDeletion()`. Thirty-six SMTP sends are in `journalctl`, one
per journal. No journal was removed without a mail going to its owner address
and that mail's token being the thing that removed it; what was skipped is the
per-journal sign-in and the rate limiter, not the gate.

**Tombstones removed.** All 39 written were deleted from `content/.deleted/`,
so every name is free to reuse. `armtest-a` never got one — see B1175.

**A restart was needed at the end.** The in-process deletion could not clear
the *running* server's `clearUserCache`/`clearConfigCache`, so `/admin` and the
landing page went on listing two already-deleted journals from stale cache
while disk and database were correct. `systemctl restart fernscout` settled it.
Anything driving deletions out-of-process again needs the same last step.

## Captured, not fixed here

- **B1176** — every file under `content/.registry/` was `root:root`, so the
  service account could neither release a lock nor reserve one. **Signup was
  broken on this instance** and nobody had tried. Fixed on the box with a
  `chown` and `npm run registry -- reconcile`; the ticket is about what ran as
  root. Same shape as B457.
- **B1175** — `deleteJournal` writes the tombstone last, after five unguarded
  steps. `release()` threw the EACCES above on `armtest-a`: journal gone from
  disk and database, no tombstone, name still locked, confirmation link already
  spent, bare `500`, no way back through the API.
- **B1166** — the instance admin is mailed an agent code it can never redeem.
  `/api/auth/request` accepts `isAdminEmail`; `agentScope` in `/api/auth/verify`
  compares only `user.owner.email`. Worse, asking revokes the owner's live code.

Nothing was found that explains how a test journal came to be created under a
person-shaped name — signup does not enforce the `test-` convention, and the
convention is documented in AGENTS.md rather than in code. That is a decision
to make, not a defect, so it is not filed.

## Left behind, deliberately

`users` and `login_codes` hold rows for `atk1`, `atk2` and `atk3` — journals
that have no directory and predate this cleanup. They are reachable from
nothing and were not touched.

## Acceptance, against the live instance

- `content/` holds `example` and `severin` and nothing else. ✔
- `/documentation.txt` advertises those two journals only. ✔
- `sitemap.xml` lists `example` and `docs`. ✔
- `/volumetest0908` and `/verify-b939` answer `404`. ✔
- No deletion was reported from a `202`; each names the mail that carried it. ✔
- **Needs a person:** `/admin` reads a cookie, so an agent cannot render it.
  Confirm its balances and usage rows now describe only the two journals.
