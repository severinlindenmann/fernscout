---
id: B1446
title: Anthropic API key may be exposed and needs rotation
type: SECURITY
priority: high
complexity: low
area: vps, secrets
found: "2026-09-11T11:32:31Z"
---

# B1446 — Anthropic API key may be exposed and needs rotation

## Why

The user believes the live `ANTHROPIC_API_KEY` used by fernscout.ch may have
been exposed. A leaked key can be used to run inference on the owner's
account until it is revoked, so it needs replacing rather than just watching.

## Work

- Generate a new Anthropic API key in the console and revoke the old one.
- Update the key on the VPS (env file the app reads it from — see
  `get-a-credential`/`vps` skills for where secrets live on the box) and
  restart the app so it picks up the new value.
- Confirm nothing else on the box or in any `.env`/deploy script still has
  the old key hardcoded.
- Not in scope: rotating any other secret (Stripe, mail, etc.) unless the
  same exposure also touched those.

## Acceptance

- Old key shows revoked/inactive in the Anthropic console.
- `/api/health` (or an actual model call through the app) works with the new
  key in place on the VPS.
- `grep` for the old key's value across the VPS env files and this repo
  turns up nothing.

## Retyped OPS → SECURITY, 2026-09-11

Found by B675, which publishes a roadmap page filtered on `type: SECURITY`.
This ticket was typed `OPS`, so **its title would have rendered to the public**:
*"Anthropic API key may be exposed and needs rotation."*

Publishing that sentence is itself a hint, whether or not the key was ever
exposed. But the retype is right on the merits regardless of the page: a
credential that may be in somebody else's hands is a security finding, not an
operations chore. `OPS` in this repository means an engagement against the
running instance whose deliverable is findings; this is a thing to fix.

The filing follows the type, so it moves to `backlog/security/` and is now
caught by both halves of the roadmap filter — the folder check and the
frontmatter check.


## Waiting on the owner — 2026-09-13

**What only you can do:** generate a new `ANTHROPIC_API_KEY` in the Anthropic
console and revoke the old one. No agent can reach that console, and nothing
here should hold a credential that could.

**What I checked, so the rest of the acceptance is already closed:**

- **The repository is clean.** The three `sk-ant-` matches are placeholders —
  `sk-ant-admin`, `sk-ant-test-`, `sk-ant-local`, 12 to 33 characters, in the
  credential skill, a completed task file and a test fixture. `git log -S`
  across all branches shows no real key was ever committed.
- **On the box the key is set in `/etc/fernscout/env`**, as expected.

**What I found that the ticket did not know about, and it matters for the
rotation:**

`/etc/fernscout/env.bak-b1125-20260909-202540` is a **full copy of 32 secrets,
including an Anthropic key**, written 9 September. There is a second,
`env.bak-20260831-212314`, with 11 secrets and no Anthropic key.

After you rotate, that backup still holds the **old** key. A revoked key is
harmless, so this is not urgent — but a stale full secret dump sitting beside
the live one is how a future rotation quietly fails to be a rotation, and the
next secret rotated may not be revoked as promptly.

**So there are two decisions, not one:**

1. Rotate the key (console, then `/etc/fernscout/env`, then restart). Tell me
   when it is done and I will confirm the app still answers and grep the box
   for the old value.
2. **Say whether I may delete the two `env.bak-*` files.** I have not touched
   them: deleting is the one action no later commit can undo, and these are
   the operator's own files. If a rotation is coming anyway, removing them
   afterwards is the tidier order.

Nothing else is blocked by this. The key being possibly-exposed does not stop
any other work.

## Refiled from an invented `waiting/` lane — 2026-09-13

Found while widening the dangling-reference id pattern for B1472 (which now
catches the four-digit ids every task since B1000 carries): this file had been
moved to `docs/tasks/waiting/`, a lane no tool here knows about —
`scripts/tasks.mjs`'s `LANES` and `test/task-ids.test.ts`'s copy of it are
both `["backlog", "open", "in-development", "testing", "completed"]`, and
`npm run tasks -- show B1446` answered "No item with id B1446" while the file
sat there. AGENTS.md's own words are "the folder it sits in is its status" —
there is no sixth folder for "blocked on the owner", and inventing one made
this task invisible to the duplicate-id check, the filename check and the
category check, not only the dangling-reference sweep that happened to notice.

Refiled to `backlog/security/`, matching its `type: SECURITY` and the folder
`categoryFor()` already derives for it. The "waiting on the owner" state is
still on the record above; it just is not a lane.
