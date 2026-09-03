---
id: B196
title: test/mail.test.ts fails on main — a kept-mail sweep test broke when the journal mail switch landed
type: ISSUE
priority: high
complexity: low
area: mail, test
found: "2026-09-03"
---

# B196 — A failing test on `main`

## Why

Noticed by the B80 testing agent as an aside, then reproduced deliberately.
`npx vitest run` is not green on `main`:

```
FAIL  test/mail.test.ts > kept mail expires > a sweep that cannot read the
      directory still sends the message
Error: mail was not sent
  ❯ sendOne test/mail.test.ts:101:24
```

`sendOne` writes a config with `{ enabled: true, transport: "file" }`, calls
`sendMail(renderMail("ana@example.test", …))`, and throws when the result is
null. `sendMail` returns null when `isEnabled("mail")` is false.

**It is a real regression, not an environment artefact.** Bisected by checking
out the commit that introduced the test:

- `fb7f040` — *"B135: kept mail expires after two days, swept on write"*, where
  this test was added: **32 passed**.
- `a760c74` (current `main`): **1 failed, 31 passed**.

Two commits touch `lib/mail/index.ts` in that range. `0a2a506` is a lane move
with no code. The other is `1de8fd9` — *"B60: a journal's own mail switch now
governs the letters it sends to its readers"* — which is exactly a change to
when mail counts as enabled. The test renders a message with no `username`, so
a mail switch that now consults the journal has nothing to consult, and the
send returns null.

That is a hypothesis about the cause, formed from the range and the commit
subject rather than from reading B60's diff — whoever owns B60 should confirm
it rather than take it from me. What is not a hypothesis is that the test
passes at one commit and fails at the other.

Why this matters beyond one red test: `AGENTS.md` requires all four checks
before anything ships, and `scripts/deploy.sh` builds on the server. A suite
that is already red on `main` means the next person to run the four checks sees
a failure they did not cause, and the usual response to that is to stop
trusting the suite. The deployed instance is on `3592ad3`, which predates both
commits, so **production is unaffected** — this is a `main`-only problem, and
cheapest to fix now.

## Work

Decide which of the two is right, because they cannot both be:

- If a message with no `username` **should** still send under a journal-scoped
  mail switch — a server-level letter, a signup code — then B60 narrowed too
  far and the fix is in `lib/mail/index.ts`. Note **B111**: signup mail already
  has no journal, and it is the case most likely to be affected.
- If it genuinely **should not**, then B135's test needs a username and the
  sweep behaviour it asserts needs re-expressing in those terms.

The first looks more likely from the outside, and it has a live consequence
worth checking either way: whether signup codes still send on an instance where
no journal has mail enabled.

## Acceptance

- `npx vitest run` is green on `main`.
- Whichever way it is resolved, a test covers a message sent with no
  `username` — that is the case that broke and nothing else pins it.
- Confirm on the deployed instance that signup codes still send after the fix
  ships, since that path has no journal to consult.
