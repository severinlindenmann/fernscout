---
name: test-the-live-site
description: Verify tasks in docs/tasks/testing against the running instance at fernscout.ch, one subagent per ticket, three at a time — file what fails, move what passes. Use when the user says "do testing", "test everything against the VPS", "run the testing campaign", "verify what's in testing", or hands over a batch of merged tickets to check.
---

# Test the live site

`docs/tasks/testing/` is work that was merged and has never been tried by
anybody. This skill empties that lane against **the deployed instance**, not a
dev server — because the whole point is to catch what only production has:
content that never got deployed, systemd units that stayed in git, real SMTP
meeting a real mail scanner.

**One subagent per ticket, three in flight, spawn a replacement as each
finishes.** A ticket is a self-contained question; a fresh agent per ticket
keeps one ticket's mess out of the next one's evidence.

## Before spawning anything

1. **Check what is deployed.** `curl -s https://fernscout.ch/api/health | jq`.
   Compare `.commit` with `git rev-parse HEAD`. If they differ, say so — you
   are testing something other than the current tree, and every verdict
   inherits that.
2. **Confirm the doors you need.** SSH to the VPS, and reading a mail copy off
   it, are both needed by roughly half the tickets. Test one of each before
   promising a full run.
3. **Provision QA journals.** Never test against `example`, `sevi` or `sevi2` —
   those are real. Create throwaways (below) and hand their tokens to agents.
4. **Write the brief.** Copy `BRIEF.md` from this skill directory into the
   scratchpad and add an `ACCESS.md` beside it holding tokens, journal state
   and the current rate-limit budget. Every agent reads both first.

## Provisioning, and why centrally

Rate limits are per-IP and every agent shares yours:

| Endpoint | Budget |
| --- | --- |
| `POST /api/auth/signup/request` | 5 per hour |
| `POST /api/v1/journals` | 5 per hour |
| `POST /api/auth/request` (`kind: agent`) | 5 per 15 min |
| `POST /api/auth/request` (`kind: guest`) | 10 per 15 min |
| `POST /api/trip-access` | 8 per 15 min |

Forty agents each signing up would exhaust that in the first minute and every
429 would read as a failure to the next agent. So **the orchestrator provisions
a pool and hands out tokens**; an agent only touches these endpoints when its
own ticket is about them, and then it is told the budget it may spend.

Three or four journals covers most campaigns: one busy, one in a second locale,
one kept **empty** (several tickets need a journal with no trips, and it is the
first thing an earlier agent destroys), one disposable for deletion tests.
Addresses are always `xydhd-<something>@severin.io` — never a real person's.

Agent tokens last seven days, which outlives any campaign.

## Reading a code, a link, or any mail

`features.mail.keepCopy` is on in production, so every message is also written
to disk. **This is how an agent gets sign-in codes, invite links and deletion
links without a mailbox** — nobody needs to relay anything.

- Mail belonging to a journal → `/var/lib/fernscout/content/<user>/mail/`
- **Signup** codes, which have no journal yet → `/srv/fernscout/mail/`

Bodies are base64 inside a multipart message and the lines end **CRLF**. Strip
the `\r` or the decode silently yields nothing:

```bash
F=$(ssh 95.216.112.173 "ls -t $DIR | head -1")
ssh 95.216.112.173 "grep -E '^[A-Za-z0-9+/=]{40,}' '$DIR/$F' | tr -d '\r' | base64 -d" \
  | grep -oE 'code is [0-9]{6}'
```

Narrow the tail with `grep -oE` to the one value you want. A whole-body dump is
sometimes refused by the permission classifier where a targeted grep is not.

**Single-use links mailed to a real domain get spent by the receiving host's
scanner within about fifteen minutes** — see B142. Read a link from the `.eml`
and redeem it *promptly*, and treat "already consumed" as data rather than as
your own mistake.

## The live content directory is not the checkout

`/var/lib/fernscout/content/` is what the site serves. `/srv/fernscout` is the
code. Deploys sync `content/locales/` and `content/rates/` and deliberately
nothing else, so **anything under `content/<username>/` in the repo may not be
on the server** — including the demo journal. Check before concluding a feature
is broken; more than once the code was fine and the specimen was missing.

Server access is **read-only**: `systemctl status/show/cat`, `journalctl`,
`ls`, `stat`, `grep`, `diff`, `md5sum`. Never restart, deploy, edit config, or
run a backup or restore. Do not read `/etc/fernscout/env` — it holds secrets.

## Two rules an agent must not decide for itself

**Publishing.** `AGENTS.md` reserves it for a person who asks in words. An
agent holds both the request and the `confirm` call, so satisfying its own code
proves only that it meant to. An agent that needs a published day reports the
bullet *not checked* and names the call — the orchestrator gets a human
decision. Grant a scoped exception only when publishing *is* the ticket, say so
explicitly, and bound it to test-flagged days in QA journals.

**Anything destructive.** A restore drill, a deletion, a mutation of live
config. If acceptance requires it, the agent stops and describes what would
need running, by whom, and what it costs. A partial verdict is the right
answer; an agent that drops a production database to close a ticket is not.

## Bookkeeping, as results come in

- **PASS** → `npm run tasks -- move <id> completed`. `completed/` is a human
  gate; you are doing it because the user asked for this campaign, and only for
  tickets that actually passed.
- **FAIL** → leave it in `testing/` and open a **new** backlog ticket for what
  was found. Never edit the original's verdict into a pass.
- **BLOCKED** → leave it in `testing/`, and put the decision to the user with
  the exact command that would clear it.
- Findings **outside** a ticket's own acceptance are where most of the value
  turns up — file them in `backlog/` with the evidence. Check first that they
  are not already a ticket; if an existing one is now half-wrong, amend it with
  a dated note rather than filing a duplicate.

Keep `ACCESS.md` current as agents change the journals. A later agent that
assumes an empty journal, and silently tests a full one, produces a confident
wrong answer — this has happened.

## When you are done

Report per ticket: verdict, what moved, what was filed. Say plainly what a PASS
means — the acceptance held on the live site today, not that the implementation
is right in general. Then clean up: the QA journals and everything in them.
Deletion is the mail-confirmed flow, so it needs the owner, and an agent that
reports a `202` as "deleted" has said something false.
