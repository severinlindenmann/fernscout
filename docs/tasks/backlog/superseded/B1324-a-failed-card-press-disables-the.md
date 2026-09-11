---
id: B1324
title: A failed card press disables the composer for good, and the only way out wipes the conversation
superseded: "B1246's own fix — components/HelperAsk.tsx:999-1015, accept() has wrapped its body in try/catch/finally { setBusy(false) } since 7 September. The symptom was the raw 500 the outage produced, not a missing finally."
type: ISSUE
priority: high
complexity: low
area: helper
found: "2026-09-10T15:53:41Z"
---

# B1324 — A failed card press disables the composer for good, and the only way out wipes the conversation

## Why

Press a card whose call fails, and the room stops accepting input entirely.

Measured on fernscout.ch, 2026-09-10, after a postcard proposal was refused with
`invalid_request` (B1322):

```
textareaValue : "I would like a photobook of the Bern Weekend trip."
askDisabled   : true          <- still true
userTurns     : 1             <- the message never became a turn
```

Typing fresh text does not release it — `askDisabled` stays `true`. Two further
messages were typed and sent over four minutes and neither produced a turn; the
transcript simply stopped. The console carries the cause and nothing else:

```
Failed to load resource: the server responded with a status of 400
https://fernscout.ch/api/helper/test-mobile/postcard
```

The send button is evidently gated on an in-flight flag that the failure path
never clears. Reloading fixes it — `askDisabled` is `false` again immediately
after — so the state is purely client-side.

**Nothing on screen says any of this.** The card prints its refusal, and the
composer just quietly stops working. A person types their next sentence, presses
send, watches nothing happen, and has no reason to suspect the page rather than
themselves.

## Why it is worse than it looks

The only recovery is a reload, and **a reload destroys every interactive card in
the room** (B1254). So the cost of one failed press is the whole conversation's
cards — and B1254 already showed the surviving prose can then invite the person
to pay for something a second time.

The two together make a single refused call an unrecoverable state for anybody
who does not know to reload, and an expensive one for anybody who does.

## Work

- Clear the in-flight flag on the failure path, not only on success. Whatever
  guards the send button has to be released in a `finally`, so no route's refusal
  can strand it.
- Check every other control the room disables while busy — the card buttons, the
  microphone, the attach control — for the same one-sided release.
- A refused call should leave the room usable and say so; today it says nothing
  at all about the composer.

## Acceptance

- Force any helper route to answer 400; the composer accepts the next message
  without a reload.
- The same holds for a network failure and a timeout, not only a 400.
- No control in the room stays disabled after a failed call.

## Closed as superseded, 2026-09-11

Found already fixed while planning the /agent run, and then left sitting in `open/`
reading as work for a day. Closing it is the correction.

B1246's own fix — components/HelperAsk.tsx:999-1015, accept() has wrapped its body in try/catch/finally { setBusy(false) } since 7 September. The symptom was the raw 500 the outage produced, not a missing finally.
