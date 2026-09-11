---
id: B1536
title: Enable the Stannp webhook on the live instance
type: OPS
priority: medium
complexity: low
area: postcards
found: "2026-09-11T20:42:15Z"
---

# B1536 — Enable the Stannp webhook on the live instance

## Why

B1484 built `POST /api/webhooks/stannp` and it verified correctly against a
local dev server (real HMAC-SHA256 signature check, 404 with no secret or a
bad one, 200 on a genuine delivery) — but nobody has actually turned it on
for real mail. Two things only an operator with a Stannp account can do,
neither done yet:

1. Create the webhook in Stannp's own dashboard, pointed at
   `https://fernscout.ch/api/webhooks/stannp`, subscribed to
   `mailpiece_status`, with a signing secret set there.
2. Set that same secret as `STANNP_WEBHOOK_SECRET` in `/etc/fernscout/env`
   on the VPS (`.env.example`'s own doc comment for it, added by B1484) and
   restart the service.

Until both happen, the route exists and is correct but is permanently 404
in production — a capability that is off by absence, exactly as designed,
just not yet switched on.

## Work

1. Sign in to the Stannp account (whichever this instance actually posts
   through — `STANNP_API_KEY` in `/etc/fernscout/env` names it) and create
   the webhook per the dashboard's own flow: URL, event
   (`mailpiece_status`), and a freshly generated long secret.
2. `ssh 95.216.112.173`, add `STANNP_WEBHOOK_SECRET=<the same secret>` to
   `/etc/fernscout/env` (root:fernscout 0640 — do not chmod 600, it breaks
   the nightly backup, per the `vps` skill), and restart the `fernscout`
   service so it picks up the new env var.
3. Send a real (or Stannp's own test) postcard, cancel it if Stannp's
   dashboard offers a way to simulate that, and confirm the webhook fired:
   `journalctl -u fernscout` should show
   `[stannp] webhook accepted: mailpieces=1 cancelled=1 ignored=0` (or the
   equivalent for whatever was actually sent).

Not doing: anything about B1532 (refunding a cancelled card) — that is
still unbuilt regardless of whether the webhook is switched on.

## Acceptance

`STANNP_WEBHOOK_SECRET` is set in the live env, the webhook is registered in
Stannp's dashboard against the live URL, and a real delivery from Stannp
shows up in the live logs as accepted rather than as a 404.
