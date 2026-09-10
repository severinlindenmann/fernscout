---
id: B1355
title: A webhook refused at the door is indistinguishable from one that worked
type: ISSUE
priority: medium
complexity: low
area: photobook, webhooks, ops
found: "2026-09-10T20:10:00Z"
---

# B1355 — A webhook refused at the door is indistinguishable from one that worked

## Why

Found the first time somebody configured the thing. The owner set up the
webhook in Gelato and sent a test event; it arrived:

```
[request] POST /api/webhooks/gelato ua="GuzzleHttp/7"
```

And that is the whole of what we know. The route answers 404 on a wrong or
missing header and 200 on a good one, and **the request log is identical
either way** — there is no Caddy access log on this instance, so the status
code is not recorded anywhere.

So a webhook configured with a typo in the header would 404 for ever and look
exactly like one that is working. Nothing would break loudly: the five-minute
sweep still settles refused orders, so the only symptom is refunds arriving
minutes late instead of at once, for ever, with nobody able to say why.

That is the shape of silence this repository keeps having to fix — the same
one as B138's absent alert handler and B1311's unreadable config.

## Work

- Log a refusal, and say **which** refusal: no header at all is "Gelato is not
  configured to send one", a wrong value is "the value does not match". Those
  are different things to go and fix. Log neither the offered value nor the
  real one — journald is not where a credential belongs.
- Log every **accepted** delivery, not only the ones acted on. Most are
  correctly ignored — a status we do not settle, an order that is not ours —
  and if only the acted-on ones appeared, a person wiring this up could not see
  it working short of breaking an order on purpose. The event and the status,
  and nothing else from the body: the rest is somebody's shipping address.

## Acceptance

- `journalctl -u fernscout | grep '\[gelato\] webhook'` distinguishes a
  delivery that authenticated from one that did not.
- No secret appears in the log.
- `npm run verify`.
