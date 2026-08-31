# W28 — Confirmation gates on destructive and committing actions

## Why

An agent that can write can be talked into deleting. The draft rule protects
readers from invention; nothing yet protects the author from an agent that
decided, on its own, that a day was a mistake.

## The gate

A two-step confirmation with a one-time code, issued by the server:

```
POST /api/v1/<user>/trips/<trip>/days/<slug>   { "action": "delete" }
→ 409 {
    "error": "confirmation_required",
    "confirm": "cf_9d2f…",          # single use, 5 minutes, this exact action
    "message": "This deletes <slug> permanently. Did the person ask you to?
                Repeat the request with \"confirm\": \"cf_9d2f…\"."
  }

POST … { "action": "delete", "confirm": "cf_9d2f…" }   → 200
```

Properties that matter:

- The code is **bound to the exact operation** — user, trip, slug, action — so
  it cannot be replayed against a different one.
- It is **single use** and short-lived.
- It is **issued by the server**, so an agent cannot construct one.
- The message asks the question the agent should have asked the person.

## Which actions are gated

| Action | Gate |
| --- | --- |
| delete a day | confirmation code |
| delete media | confirmation code |
| overwrite an existing day's body | confirmation code |
| order a photobook | confirmation code **and** payment (below) |
| send postcards | confirmation code **and** payment |

## Money is a harder gate than a code

An agent must never be able to spend money. For anything that costs:

1. The agent creates an **order**, which is a draft like everything else.
2. The server emails **the person** a payment link.
3. Only a completed payment releases the order to the provider.

No confirmation code is enough on its own here — the second factor is a human
paying, out of band.

## Work

1. `lib/agentConfirm.ts` — issue, verify, burn. HMAC over
   `(user, trip, slug, action, issued)`, so nothing is stored.
2. `DELETE`/`action` handling in the v1 day route, gated.
3. The same gate in MCP, as a `confirm` argument, with the error text as tool
   output rather than a protocol error so the agent reads it.
4. Order records, payment link mail, and a released/unreleased state. The
   provider call stays behind the existing `dry-run` backends.
5. `/agent.md` documents the gate, because an agent that has read the guide
   should not be surprised by it.

## Acceptance

- A delete without a code returns 409 and changes nothing.
- The code works once, then fails.
- A code for one slug fails on another.
- No order reaches a provider without a recorded payment.

## Stop line

Payment provider integration stops at the link and the state machine. Nothing
in this repository takes a card number.
