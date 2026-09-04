---
id: B319
title: Letting somebody in means handing them a link by hand, and approving means being at a browser
type: FEATURE
priority: high
complexity: high
area: contacts, invites, mail
found: "2026-09-04T16:55:58Z"
started: "2026-09-04T17:01:25Z"
merged: "2026-09-04T17:26:37Z"
---

# B319 — Letting somebody in means handing them a link by hand, and approving means being at a browser

## Why

Three requests from the owner on 2026-09-04, from one session of trying to let
family into a journal. They are one feature: **the invitation should travel by
mail, in the reader's language, and the owner should be able to approve from
their inbox.**

**Inviting.** `POST /api/v1/<user>/invites` returns a link and stops there. The
owner then copies it into a chat themselves. What they asked for: when they
tell an agent to invite somebody, the agent should ask **which language** that
person reads, offer to **send the invitation by mail**, and send it in that
language.

**Approving.** Today the approval queue is a page — `/<user>/contacts` — and
`approveContact` is reachable only from it. The owner asked that approving be
possible **by mail** as well. B272 already showed the cost of the current
shape: the owner's only notice was one mail that failed to send, and the
request sat unseen.

**And the mail that lands afterwards points at the front door.** The "You're
in" letter carries `https://fernscout.ch/viki` — the journal's address, which
for a `guest` journal shows a stranger nothing. The owner wants **a direct
authenticated link**, so somebody who has just been let in arrives *in*.

## The part that needs care

Two of the three touch the credential model, and it is the part of this
codebase with the most reasoning already written down.

- **Auto-approving somebody the owner invited by mail** skips the double
  opt-in (C12). That is deliberate today: whoever opens an invite proves their
  own address and lands in a queue, and `approveContact` is *"the only thing in
  the codebase that creates a grant"* (AGENTS.md). The argument for skipping
  it is real — the owner typed the address, so the owner has vouched for it —
  but the failure mode is a typo granting a stranger access to a private
  journal, silently. Weigh that explicitly; do not assume the owner's request
  settles it. A middle path: mail the invitation *and* pre-approve the address
  so that whoever proves it is admitted without a second decision — the proof
  still happens, the owner's queue does not.
- **An authenticated link in a mail** is a credential in an inbox. There is
  precedent and it is the right precedent: the welcome mail's standing
  sign-in link (B29/B283), which does not expire, versus the relayed one that
  dies in fifteen minutes. Read why those two differ before choosing a
  lifetime here, and note B274 — a reader's manage link is already permanent
  bearer authority and its label is being reconsidered for exactly this
  reason.
- **Approving from a mail** means a link that grants somebody else access.
  `lib/deletions.ts` is the model: a single-use token to a page with a button,
  because the consequence is not reversible. `lib/agentConfirm.ts` is
  explicitly *not* the model and must not be used — it is not single-use and
  it goes to the agent.

## Decided

**Pre-approval is fine — the owner's decision on 2026-09-04:** *"that's fine
pre approve, that is a user error I don't care about."* So an address the owner
hands over is vouched for, and they do not want a second decision in their own
queue for somebody they just invited by name.

**One half of the double opt-in is kept anyway, and it is not the half that was
dismissed.** The owner waved away *their own* typo, which is theirs to wave
away. What remains is that `POST /api/v1/<user>/invites` is called by an
**agent** holding an owner-scoped token — so "pre-approve whatever address
arrives" means an agent that mistypes, or invents, an address creates a real
grant on somebody's private journal with nobody having decided anything. That
is not user error.

So: **mail the invitation and pre-approve the address, and let whoever opens it
still prove they hold it.** The owner gets what they asked for — no queue, no
second click, the invited person is in the moment they arrive — and a wrong
address grants nothing to anybody instead of granting everything to a
stranger. The proof costs the invited person one click on a link already in
their hand.

If that is not what was wanted and a grant should exist before anyone proves
anything, say so and it is a one-line change — but it should be a sentence
somebody wrote on purpose, not a default that arrived by omission.

## Work

Not designed. What has to be decided, and in this order:

1. **Whether the owner may pre-approve an address they typed**, and if so
   whether the invited person still proves their address. Everything else
   depends on this answer.
2. **The invitation mail**: the reader's language (the contact's `locale`
   already exists and `pickLocale` already chooses per recipient), what it
   says, and what its link does.
3. **The approval mail to the owner**: whether the button approves directly
   or opens the queue with that request in front of them. The second is
   cheaper and nearly as good.
4. **The "You're in" link**: an authenticated destination rather than the
   journal's public address, with a stated lifetime and a reason for it.
5. Then the agent-facing side: `create_invite`'s arguments grow a language and
   a "send it" option, and both documents say what the agent should offer —
   which is B317's third bullet, so keep the two consistent.

Related, and worth reading first: B272 (the owner's notice was lost and could
not be resent), B273 (a reader has nowhere to leave a postal address), B274
(the manage link's label), B283 (the handover credential's lifetime reasoning).

## Acceptance

- An owner can tell an agent to invite somebody by name and address and have
  the invitation sent, in that person's language, without copying a link.
- Whoever is let in receives a mail that puts them inside the journal, not at
  a gate.
- An owner can act on a waiting request from their inbox.
- Whatever is decided about proof of address is written down with its
  reasoning, and no path creates a grant for an address nobody proved unless
  that decision was taken deliberately.

## Scope split, so this can start now

B316 and B317 hold `lib/api/agentCopy.ts`, `lib/api/documentation.ts` and
`lib/validate/entry.ts`. This task is therefore **the server side only**: the
invitation mail and its language, pre-approval, the authenticated destination
in the "You're in" letter, and approving from the owner's inbox.

The agent-facing half — `create_invite` growing a language and a "send it"
argument, and both documents saying what an agent should offer — is **B317's
third bullet**. Leave those files alone and note in your report what B317 will
need to say, so the two halves meet.
