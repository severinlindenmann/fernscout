---
id: B1694
title: api/health reports signup enabled while the instance config disables it, so the instrument contradicts the gate
type: ISSUE
priority: high
complexity: medium
area: Capabilities
found: "2026-09-14T06:00:37Z"
---

# B1694 — api/health reports signup enabled while the instance config disables it, so the instrument contradicts the gate

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

On the live instance today:

- `/var/lib/fernscout/config.json` (what `FERNSCOUT_CONFIG` points at) says
  `features.signup: {"enabled": false, "phoneBackend": "whatsapp-inbound"}`.
- `GET /api/health` answers `capabilities.signup: {"enabled": true}` — with no
  `reason`, the shape a genuinely-on capability has.
- A sibling that is off answers correctly:
  `fulfilmentRelay: {"enabled": false, "reason": "not enabled on this server"}`.

**The gate itself is right.** `POST /api/auth/codes` with `for: "signup"`
answers **403**, and `/signup` answers **404**. Nobody can sign up. This is a
reporting fault, not an open door — which is why it is an issue and not a
security ticket.

**It still matters, and the reason is what `/api/health` is for.** It is the
one place an operator looks to find out what their own instance is doing, and
AGENTS.md's rule is that an optional capability must be *absent rather than
broken* when off, with health explaining why. An operator reading this would
conclude their alpha is open to the public. The instrument contradicting the
gate is the same class of fault as a test that passes either way: it cannot be
trusted in the direction anybody would use it.

It is also "one fact, two addresses" — the enforcement path and the reporting
path disagree about a single boolean, which is the shape this contract was
written to remove.

## What is established, and what is not

`resolveOne` (`lib/capabilities.ts`) *does* check
`loadServerConfig().features[name].enabled` first and returns
`"not enabled on this server"` — so the obvious path is correct and something
downstream of it is not. Two candidates, neither confirmed:

- `DEFAULT_FEATURES` in `lib/config.ts` backfills missing feature keys. The
  repository's own `site/config.json` carries `signup: {"inviteOnly": true}`
  with **no `enabled` key at all**, so the merge between the shipped default
  and the operator's override is the first place to look.
- `signup` joined `OPERATOR_ONLY_FEATURES` in B1666 (decision 5) the same day
  this was noticed. That changed which branch of `resolveOne` it takes.

Note the timing but do not assume causation: this was found *because* decision
5 removed `signup` from health's `off` list, which is what made the wrong value
visible. The wrong value may well predate it.

## Work

Find where the operator's `enabled: false` is lost between the config file and
`resolveCapabilities()`. Then make the two paths read the same fact — the gate
is right, so the reporting should be made to agree with it, not the reverse.

## Acceptance

With `features.signup.enabled` false in the instance config, `/api/health`
reports `signup: {enabled: false, reason: …}`, and a test pins that a
capability disabled in the server config reports disabled — whichever branch of
`resolveOne` it takes.
