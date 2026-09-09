---
id: B1192
title: A held WhatsApp answer is delivered with no sign it was delayed
type: ISSUE
priority: medium
complexity: low
area: whatsapp
found: "2026-09-09T22:20:05Z"
merged: "2026-09-09T22:33:12Z"
---

# B1192 — A held WhatsApp answer is delivered with no sign it was delayed

## Why

Found during end-to-end simulation of the WhatsApp channel (run
`2026-09-09-whatsapp-agent`, scenario 16). `lib/whatsapp/dispatch.ts:146-150`
delivers a held answer verbatim on the next inbound message:

```ts
const held = takeHeldAnswer(username, message.from);
if (held) {
  await sendOutboundReply(message.from, held.outbound, username);
  console.log(`[whatsapp:inbound] delivered a held answer to ${maskNumber(message.from)} (${username}), held since ${held.heldAt}`);
}
```

`held.heldAt` — when the answer was actually ready — only reaches the
server's own console log. The text a person receives is exactly
`held.outbound`, with nothing saying it is an answer to something they said a
while ago. `lib/whatsapp/held.ts`'s own module doc calls this "an answer that
was ready before the window was", and B1061's brief called for delivering it
"with the when-it-was-ready line" — no such line exists in
`site/locales/*.json` (`grep -n "held" site/locales/en.json` finds nothing
past a `me.tripPartial` string) or anywhere in `lib/whatsapp/`.

Reproduced directly: held `sendOutboundReply(..., { kind: "text", body:
"Here's what I found for your earlier question: it rained." }, "test-whatsapp")`
while the window was closed, then a fresh inbound message delivered that body
byte for byte with no framing.

For a conversation that went quiet for a day (the exact case this mechanism
exists for), a reply that looks like an answer to nothing the person just said
is confusing rather than helpful — especially for a reader who does not track
that WhatsApp has 24-hour windows at all.

## Work

Wrap a held answer's delivery with a short line naming the delay — using
`held.heldAt` — before `held.outbound`'s own content, for the `text` shape at
least (buttons/list outbounds may need the same treatment or a text-only
fallback). Add the string to `site/locales/en.json`, `de.json`, `hu.json` and
run `npm run i18n:keys`.

## Acceptance

A `holdAnswer()` → wait past the window → next inbound round trip in
`test/whatsapp-window.test.ts` (or a new test) shows the delivered outbound
carries a delay-indicating line, not just the original body.
