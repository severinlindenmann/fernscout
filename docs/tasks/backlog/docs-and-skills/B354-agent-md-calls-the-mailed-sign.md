---
id: B354
title: agent.md calls the mailed sign-in link standing with no expiry, and it is single use
type: DOCS
priority: high
complexity: low
area: agent guide
found: "2026-09-04T19:57:27Z"
---

# B354 — agent.md calls the mailed sign-in link standing with no expiry, and it is single use

## Why

`agent.md`, on the sign-in link returned by journal creation:

> **Their welcome mail carries a second link, not this one.** … the mailed one
> is **standing — no expiry, good in a week** — while the one you are holding
> dies in fifteen minutes.

The welcome mail itself says the opposite, in its own body: "It works once."
And it does. Observed 2026-09-04 on fernscout.ch: the welcome mail's
`/<user>/s/…` link, followed about six minutes after creation, redirected to
`/<user>/me?signin=expired` — "That link had already been used."

The site's own handling of this is good and says why (mail scanners open links
before the reader does — B142). The guide is what is wrong.

It matters because the guide tells the agent to reassure the owner with it: an
agent that has read this will say "the link in your email keeps working" to
somebody whose link has already been spent, and then has no account of what
went wrong.

## Work

Correct the passage. The mailed link is single use like the relayed one; what
actually differs is that it survives a fresh code being requested for that
address. Say that, and say that a scanner may spend it first, so the six-digit
code is the reliable route.

## Acceptance

No sentence in `agent.md` claims the mailed sign-in link is standing or has no
expiry, and the difference it does have is stated correctly.
