---
id: B1697
title: B1232's authentication-template blocker no longer blocks anything live
type: OPS
priority: low
complexity: low
area: whatsapp, signup, meta
found: "2026-09-14T06:18:07Z"
merged: "2026-09-14T06:35:42Z"
completed: "2026-09-14T16:32:51Z"
---

# B1697 — B1232's authentication-template blocker no longer blocks anything live

## Why

B1232 (priority: high, found 2026-09-10) says going live with the WhatsApp
phone-passcode flow from B1222 needs an approved authentication template,
which needs business verification the account does not have. That framing
is filed as blocking.

It stopped being blocking the same day. B1234 ("Proving a number needs a
template Meta will not grant — the inbound message already proves it"),
merged 2026-09-10T06:08:57Z — two hours after B1232 was found — replaced the
authentication-template approach entirely with a free WhatsApp-inbound
proof (a `wa.me` link with a token; the webhook sees it arrive from a
number). B1234's own text says explicitly: *"B1232 (verification +
authentication templates) stays in the backlog as optional future polish."*

Checked directly against the live instance on 2026-09-14: `features.signup.
phoneBackend` in `/var/lib/fernscout/config.json` is `"whatsapp-inbound"`,
not `"whatsapp"` (the code-template mode B1222/B1232 describe). The
authentication template B1232 wants created
(`fernscout_auth_code`/en, id `1635433008002315`) is still `REJECTED`,
category `UTILITY`, and business `1154303934071130` is still
`business_verification_status: not_verified` — nothing has changed on
Meta's side and nothing needs to, because the live signup flow does not use
this path at all.

## Work

Re-file B1232 as `priority: low` (or `wontDo`/`superseded: B1234` if a
person agrees it should be), reflecting that it is optional polish for a
verified-business future, not a blocker for anything currently live. No
code change — this is a triage correction, not a diff.

## Acceptance

B1232's priority and framing match what B1234 already decided: parked,
optional, not blocking.
