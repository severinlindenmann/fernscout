---
id: B1287
title: The send button says it prints and posts real cards while the instance is set to render free samples and post none
type: ISSUE
priority: high
complexity: low
area: postcards
found: "2026-09-10T10:53:37Z"
---

# B1287 — The send button says it prints and posts real cards while the instance is set to render free samples and post none

## Why

Step 3 of `/<user>/postcards/<id>` on fernscout.ch, today:

> **Send 1 postcard for 20 credits**
> This prints and posts real cards, and spends the credits. It cannot be undone.

`/api/health` on the same instance, at the same time:

```json
"postcards": { "enabled": true,
  "note": "features.postcards.live is not set — stannp renders a free sample of
           every card and dispatches none of them" }
```

So on this instance the sentence is false in its first clause and true in its
second: **nothing is posted, and the credits are spent.** `lib/postcard/send.ts`
documents the behaviour plainly — *"`stannp` really posts — subject to
`features.postcards.live`, which is off unless an operator said otherwise and
which makes every request a free sample render"* — and the copy on the button is
a constant that does not consult it.

This is the failure this codebase takes more seriously than any other. AGENTS.md
opens on a 71-year-old being told *"Der Text ist gespeichert"* when nothing had
been written, and says of the postcard flow specifically: **"Hand over the URL
and say a preview is waiting. Do not say the cards have been sent."** The same
rule has to hold for the page's own button, which is the last thing a person
reads before money moves.

Twenty credits is about CHF 4. A person sending four cards to family, told they
are posted, will find out weeks later from the family.

I did not press it — the behaviour above is from the health note and the source,
not from spending the credits to see.

## What to decide

Two answers, and it is an operator's call which:

- The instance should be live. Then set `features.postcards.live` and the
  sentence is true. `/api/health` is already reporting the gap, so this is a
  configuration decision somebody has to make deliberately.
- The copy should follow the switch. A card that will not be posted must not say
  it will be — and arguably a server in sample mode should not charge for it
  either, which is the sharper question hiding behind this one.

Doing the first without the second leaves the next operator with the same trap.

## Acceptance

- With `features.postcards.live` unset, no page offers to post a real card, and
  `/api/health`'s note is reflected in what the owner is told.
- With it set, the current wording is correct and unchanged.
- Whether credits are spent on a card nobody receives is answered deliberately,
  in the code, with a comment saying why.
