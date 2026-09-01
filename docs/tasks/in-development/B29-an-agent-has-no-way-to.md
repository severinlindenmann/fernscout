---
id: B29
title: An agent has no way to hand its owner a working sign-in link
type: FEATURE
priority: low
complexity: medium
area: auth, api, journals
found: "2026-09-01"
started: "2026-09-01"
---

# B29 — An agent has no way to hand its owner a working sign-in link

## Why

An agent that has just built somebody a journal is sitting in a conversation
with them. The natural end of that conversation is "here, open this and look at
what I wrote" — and it cannot say that. The only way in is the welcome mail
(B27, which puts a sign-in link in it), so the person has to leave the chat,
find an email and come back. The request behind this task was exactly that:
let the agent relay the link so the mail is a backup rather than the only door.

**The reason it does not already work this way is decision 24**, and it should
be argued with rather than routed around. Agent tokens arrive in
`Authorization: Bearer` and guest sessions arrive in a cookie; `resolveSession`
refuses to treat one as the other, so that reading the site on your phone
cannot put a credential that can rewrite it in your pocket. Handing an agent a
URL that opens a signed-in session as the owner crosses that line from the
other side: it puts a *reading* credential for a human into a program's
transcript, where it may be logged, summarised, or repeated back into a context
window that outlives the conversation.

That is not automatically a no. The link is single-use, short-lived, and grants
a guest session rather than a write token — and the agent that would carry it
*already holds an agent token for the same journal*, which is strictly more
powerful. Handing it a weaker credential it could not use to do anything it
cannot already do is a much smaller step than it first looks.

What makes it a real decision anyway: the agent token was issued to the agent,
and this link is issued to the *person*. A token in a transcript that signs
somebody in as themselves is a different kind of object from a token that
authorises a program, even when the second can do more.

Depends on B27 — that task is what makes a sign-in link exist at all.

## The decision (author, 2026-09-01): yes

> The agent is allowed to hand out authentication URLs etc., that is fine.

So an agent may carry an owner sign-in link. The reasoning that survives from
the argument above, and which the implementation keeps: the agent already holds
an agent token for the same journal, which is strictly more powerful, so the
link grants it nothing it did not have. What is being accepted is that a
credential belonging to the *person* now passes through a transcript.

Two things follow from accepting that rather than waving it away, and both are
in the build:

- **It is short-lived.** Fifteen minutes, not the mail's permanent one. The
  relayed link is used inside the conversation that produced it or not at all,
  and a transcript outlives the conversation — so the copy that lands in one
  should be worthless by the time anybody reads the log. This is the whole
  difference between the two links and the reason `issueRelayLink` exists
  beside `issueStandingLink`.
- **It is named, never folded into `url`.** An agent handing over "the journal
  address" must not be handing over a session by accident.

## Work

- ~~Decide first~~ — decided above.
- If yes: return it from `POST /api/v1/journals` as a clearly named field, not
  folded into `url`, so an agent cannot hand it over by accident when it meant
  to give somebody the plain address.
- Say in `agent.md` what it is and what to do with it: give it to the person,
  once, and do not store it. An agent that is not told this will treat it as an
  ordinary URL.
- Shorter-lived than the mail's copy, if both exist. The relayed one is used
  within a minute or not at all.

Not doing: any change to what a guest session may do. If the link needs to
grant more than `isOwner()` already gives, that is a different task.

## Acceptance

- The decision is recorded in this file either way.
- If built: the field is separately named in the 201, documented in
  `agent.md` and `openapi.json`, and a test asserts that redeeming it produces
  a guest session and that presenting it as a bearer token is refused.
- If not built: the file is in `completed/` with the reasoning at the top.
