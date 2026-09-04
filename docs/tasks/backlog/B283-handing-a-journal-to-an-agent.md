---
id: B283
title: Handing a journal to an agent means reading six digits down the phone, and the page offers two lines instead of a prompt
type: FEATURE
priority: medium
complexity: high
area: auth, me-page, agents, documentation
found: "2026-09-04T12:43:00Z"
---

# B283 — Handing a journal to an agent means reading six digits down the phone, and the page offers two lines instead of a prompt

## Why

`components/AgentHandover.tsx` is what an owner is given to start an agent: a
URL, their email address, and a copy button.

```
Gib diese zwei Zeilen einem Agenten. Er liest dort die Anleitung
und fragt dich nach einem Code.

  https://fernscout.ch/documentation.txt
  viki@severin.io
```

Two lines and a promise that the agent will know what to do with them. What
actually follows is: the agent reads `/documentation.txt`, finds `/agent.md`,
calls `POST /api/auth/request`, and then asks the owner for a six-digit code
that has just arrived in their mail — which the owner reads out. Then the agent
has a token and still knows nothing about the journal: there is no single call
that says what is waiting, so it makes four or five (B91 is that finding, and
its `GET /api/v1/<user>/status` is what this task's prompt should tell an agent
to call first).

The ask is a **complete, pasteable prompt**: this journal already exists, here
is its address, here is a key that works, call `status` before you do anything,
here is the guide. Copy, paste, done — no code read aloud, no round trip.

This block is also what a brand-new owner meets on the empty trip list
(`app/[user]/me/MePageContent.tsx:226` notes it is shared), so it is the first
thing anybody sees in a journal with nothing in it. Whatever it says is the
product's first instruction.

## The decision this takes, and who took it

**The author has chosen to put a live 7-day agent token in the page, after being
shown the alternative and the cost. That decision stands and this task builds
it.** It is written down here because it reverses a stated property, and the
next person to read `resolveSession` will otherwise take this for a bug.

Today: agent tokens arrive in `Authorization: Bearer` and nowhere else, guest
sessions arrive in a cookie and nowhere else, and `resolveSession` refuses to
treat one as the other. ROADMAP decision 24 gives the reason in a sentence —
reading the site on your phone must not put a credential that can rewrite it in
your pocket — and `MePageContent.tsx:247` prints that sentence to the owner.
After this task, the page a guest cookie opens will mint and display a Bearer
token. The sentence on the page and the paragraph in the ROADMAP both stop being
true and have to be rewritten, not left standing.

`openAgentSession` (`lib/auth/index.ts:700`) is the function that mints one
without a code, and its comment is explicit: *"The one caller is `POST
/api/v1/journals` … Nothing else may use this; every other path goes through a
code."* This task adds the second caller. Rewrite that comment in the same
change; a stale invariant is worse than none.

### The one thing that has to be bounded

**A guest cookie lasts 365 days** (`SESSION_TTL_MS`, `lib/auth/index.ts:70`);
an agent token lasts 7. So a naive "button that mints a token" means a
year-old read cookie on a phone in a drawer can issue fresh write credentials
indefinitely, and the 7-day expiry buys nothing — the ceiling is the cookie, not
the token.

Signup is the precedent for how to bound it: its own session lives **20
minutes**, with the reason in the code — "short enough that a token which can
create journals is not lying around afterwards". The mint needs the same shape:
a recent proof of the address, not merely a valid cookie. Which of these it is
belongs in the plan, not decided here:

- a freshness window — mint only within N minutes of a code being verified,
  and otherwise send the owner through `/api/auth/request` first;
- a re-verification step on the button itself;
- a hard cap on live agent sessions per journal, with `listSessions`
  (`lib/auth/index.ts:893`) already able to show and `revokeSession` to kill
  them.

Whatever is chosen, the page has to be able to say *"this key works until
Thursday and here is how to kill it"*, because a credential a person cannot
revoke is one they cannot hand out carefully.

## Work

A plan in `docs/plans/`, because the freshness question above decides the shape
of the route, and then:

- **A route that mints an agent token for the signed-in owner**, owner-only,
  bounded as the plan decides, calling `openAgentSession` and logging that it
  did. Never for a guest, never for a trip person — a buddy holds a
  trip-scoped token and gets it the way they get it now.
- **`AgentHandover` renders the prompt**, not two lines: journal URL, the token
  and its expiry, "call `GET /api/v1/<user>/status` first", and the guide link.
  One copy button for the whole block.
- **Depends on B91** for `status` to exist. Until it does, the prompt would
  name a call that 404s — so either B91 lands first or the prompt names today's
  calls and is updated when it does. Say which in the plan.
- **The token is shown once.** No storing it to re-display; that is the
  argument B280 had to have for invite links and it does not transfer to a
  write credential. Re-issuing means minting a new one and revoking the old.
- **The warning text changes rather than disappears.** The owner now holds the
  key rather than reading a code, so what they need told is different and not
  less: what it can do, until when, that it must not go in a group chat, and
  where to revoke it.
- **Rewrite decision 24 in `docs/ROADMAP.md`**, the "one rule" section of
  `AGENTS.md`, the `openAgentSession` comment, and `me.tokenWarning` in all
  three locales.
- **`/agent.md` and `/documentation.txt`** should describe the pasted-prompt
  entry, since an agent arriving with a token and no code flow is now a
  supported way in.

Not doing: the same block for a trip-scoped buddy token, and any browser
session that can write directly — this hands a credential to an agent, it does
not make the browser an editor. That is B262 and a separate decision.

## Acceptance

- Signed in as the owner, `/<user>/me` shows a copyable prompt containing the
  journal URL, a live token, its expiry, and the instruction to call `status`
  first.
- The token in that block authenticates `GET /api/v1/<user>/status` and
  `POST .../days`, and is refused for another journal.
- The mint route refuses a guest session, a trip person, and an expired or
  stale cookie per whatever freshness rule the plan chose — with a test per
  refusal.
- The owner can see live agent sessions and revoke one, from the page.
- No page or API response ever shows the token a second time.
- Decision 24, `AGENTS.md`, `openAgentSession`'s comment and `me.tokenWarning`
  all describe what is now true, in all three locales.
- `claude-security` has been run over the branch; every finding fixed or
  captured by id.
- The four checks pass.
