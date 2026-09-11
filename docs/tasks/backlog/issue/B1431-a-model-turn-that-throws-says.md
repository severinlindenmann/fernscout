---
id: B1431
title: A model turn that throws says nothing, on every ordinary WhatsApp reply
type: ISSUE
priority: medium
complexity: low
area: whatsapp
found: "2026-09-11T08:30:41Z"
---

# B1431 — A model turn that throws says nothing, on every ordinary WhatsApp reply

## Why

`lib/whatsapp/dispatch.ts`'s `answerOnWhatsapp` (~809-816) is where every
ordinary text turn on WhatsApp routes — greet/acknowledge done, no media, just
words — through `answerInThread`. When that call throws:

```ts
} catch (err) {
  // The credit bought nothing — B1091, the same refund the web door gives.
  await refund(username, HELPER_TURN_CREDITS, ledgerRef);
  console.error(`[whatsapp:inbound] model turn failed for ${username}:`, err);
  return;
}
```

The credit is correctly refunded, but nothing is ever sent back to the
sender. This is the largest surface of the three silent drops found while
building B1271/B1404: `handleVoiceNote`'s download failure and
transcription failure (B1430) each cover one narrow path; this one is hit by
any ordinary text message whenever the model call itself throws — a timeout,
a provider outage, a bad response shape — which is the single most common
kind of turn on this channel.

Found while building B1271, which scoped to the voice-note download-failure
branch only per its own ticket text; not fixed here for the same reason
B1263 spun this off rather than folding it in.

## Work

Reply with one honest sentence before returning from the catch block —
reuse an existing locale string if one already covers "something went wrong,
try again" for a model-turn failure elsewhere (check the web helper's own
handling of `answerInThread` throwing), otherwise add one.

## Acceptance

An `answerInThread` call that rejects during an ordinary WhatsApp text turn
(post greet/acknowledge) produces a non-empty reply to the sender, with a
test verifying it — the credit is still refunded (already covered) and now
a message is also sent.
