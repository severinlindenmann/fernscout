---
id: B1694
title: api/health reports signup enabled while the instance config disables it, so the instrument contradicts the gate
type: ISSUE
priority: high
complexity: medium
area: Capabilities
found: "2026-09-14T06:00:37Z"
merged: "2026-09-14T06:48:46Z"
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


---

## What it turned out to be, 2026-09-14

**The premise moved, and neither candidate in "What is established" was it.**
Checked against the live instance before touching anything:

- The live `/var/lib/fernscout/config.json` no longer carries
  `signup.enabled: false` at all — it reads
  `{"phoneBackend": "whatsapp-inbound", "inviteOnly": true}`.
- `POST /api/auth/codes` with `for: "signup"` answers **403
  `signup_not_invited`**, not a `signup_disabled` refusal.
- `/signup` is 404 because there is no `app/signup/` route in this codebase,
  not because a gate refused.

So there was no lost `enabled: false`. **B1693 had already deleted that
switch**: signup is on wherever the server can do it — a database and
`SESSION_SECRET` — and `features.signup.inviteOnly` is what narrows it.
`enabled: true` was the correct answer, and 403 `signup_not_invited` was the
correct refusal.

**The complaint survives its own premise, which is why this was still worth
fixing.** The ticket's real sentence is "an operator reading this would
conclude their alpha is open to the public", and that was true of a health
page saying `signup: {"enabled": true}` and nothing else. The limit was
discoverable only by being refused by it.

`resolveOne` already had the seam: `enabled: true` carries an optional `note`,
which is how a print provider on `dry-run` reports that it composes orders and
posts nothing (B492). `signup` now uses the same one to say which of the two
instances it is. Not `enabled: false` — an invited address completes a signup
today, so the capability genuinely is on.

Two things found alongside:

- **`note` was in no schema.** It has been emitted since B492 and
  `/openapi.json` documented only `enabled` and `reason`, so every caller
  reading the contract rather than the response was told a dry-run printer and
  a real one look identical. Added, with both cases named.
- The `enabled` key still written in the live config is ignored rather than
  obeyed, exactly as `lib/config.ts` says. Harmless, and worth deleting from
  the live file when somebody next edits it, so it cannot be read as a switch
  that stopped working.
