---
id: B1137
title: There is no place to try a change against real data before it reaches fernscout.ch
type: OPS
priority: medium
complexity: medium
area: ops, deploy, environments
found: "2026-09-09T18:27:20Z"
---

# B1137 — There is no place to try a change against real data before it reaches fernscout.ch

## Why

There are exactly two places this software runs: a laptop, and fernscout.ch.
The laptop has SQLite, dry-run print providers, printed OTP codes and `.eml`
files on disk; fernscout.ch has Postgres, live Gelato, a real WhatsApp number,
Stripe and real money. Nothing sits between them, so every difference between
those two lists is discovered in production or not at all.

That gap is where this project's own tickets keep landing. B1119 is a proxy
config that reached git and not the running host. B1075 is an off-site backup
that has never once succeeded on the only host that has one. B911 and B437 are
whole flows that "have never run against the live site" because the only way to
run them is with real money on the instance real readers use. Each of those is
the same shape: a thing that can only be tried where it must not be tried
first.

A second deployment — `dev.fernscout.ch` — is a place where the answer to
"does this work with Postgres, behind Caddy, with the real provider in test
mode" can be got before a deploy rather than after one. It is also where the
restore drill in `docs/disaster-recovery.md` can actually be run, since
restoring onto the live host is not a drill anybody will do twice.

What makes this worth its cost rather than a second thing to maintain is that
the deploy is already scripted and capability-switched: `scripts/deploy.sh`,
`deploy/fernscout.caddy`, `FERNSCOUT_CONFIG` and `lib/capabilities.ts` mean a
second instance is configuration, not a fork. The risk is the opposite one —
that a dev instance drifts into being a third environment nobody trusts either.

## Work

- Decide, and write down in `docs/`, the three questions that make this real or
  not: does it share the VPS or get its own; does it carry its own Postgres or
  a second database on the same one; and what is on it — a copy of real
  journals, or content made for it.
  The recommendation to argue against: its own small VPS, its own database,
  and content that is `test-` named and never a copy of a real journal, so a
  leak from dev is a leak of nothing.
- Every provider that costs money runs in its test mode there, and
  `/api/health` must say so on its face — Stripe on `sk_test_`, print providers
  in `dry-run`, no live WhatsApp template sends. A dev instance that can spend
  is worse than no dev instance.
- Keep it out of the world: no search engines, no `sitemap.xml` a crawler will
  find, and a way in that is not "it is public but nobody knows the name".
- `dev.fernscout.ch` in DNS and in Caddy, deployed by the same
  `scripts/deploy.sh` with a different `FERNSCOUT_CONFIG` and a different
  `DATA_DIR` — no second script, no second procedure. Where the script cannot
  do it, that is the finding.
- Say what it is for, in one paragraph in `docs/`, so it does not become a
  place where broken things live: it is for trying a deploy, running the
  restore drill, and exercising a provider in test mode. It is not a staging
  gate every change has to pass.
- Capture separately: whatever `deploy.sh` or the Caddy block turns out to
  hardcode about the one host it has ever run on.

Not doing here: automatic deploy on merge (B131 is that ticket, and it wants
this environment to point at first), and any promise that a change is tested
because it ran on dev.

## Acceptance

- A written decision covering host, database and content, with the reasoning.
- `https://dev.fernscout.ch/api/health` answers, names its own data dir, and
  reports every money-spending provider in a test or dry-run mode.
- `scripts/deploy.sh` deploys it with no edits to the script itself — only
  different environment.
- The restore drill in `docs/disaster-recovery.md` has been run there once,
  end to end, and the doc updated with what actually happened.
- It is not reachable from a search engine and carries no copy of a real
  person's journal.
