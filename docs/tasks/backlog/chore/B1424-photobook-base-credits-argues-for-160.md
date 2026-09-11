---
id: B1424
title: PHOTOBOOK_BASE_CREDITS argues for 160 credits and 2 a page, a pricing model that no longer exists
type: CHORE
priority: low
complexity: low
area: credits, pricing, docs
found: "2026-09-11T07:33:33Z"
---

# B1424 — PHOTOBOOK_BASE_CREDITS argues for 160 credits and 2 a page, a pricing model that no longer exists

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

`lib/credits/pricing.ts:118-146` is forty lines of careful reasoning for a
number that is not the one below it. It argues:

> **The base was 90 until B840, then 160 against an estimate.** … the base
> stays 160 here anyway: a second plan (not this one) splits the build charge
> from the print charge … At 160 credits and 2 a page, a 52-page book is
> priced … at roughly twice landed cost.

Then:

```ts
export const PHOTOBOOK_BASE_CREDITS = 40;
```

The split that comment calls "a second plan (not this one)" has since landed —
`quote.ts:90-95` returns `buildCredits` and `printCredits` separately, and
`build.ts:84` says the build charge no longer depends on size or cover. So the
comment describes the world before the split while the constant lives in the
world after it, and the "2 a page" component it reasons about does not exist
anywhere in the code.

The measured Gelato basis in the same block is still good and still worth
keeping — it is where the 2026-09-07 quote is written down, and
`test/photobook-pricing.test.ts` leans on it. What is stale is everything
arguing for 160.

The cost of leaving it: the reasoning for the number that actually ships — why
a flat 40, why deliberately below landed cost, why the print carries the
margin instead — is recorded nowhere. Found while answering "is 40 credits
right?", which took reading three files because the comment answers a
different question.

## Work

- Rewrite the block for the split that exists: what the build charge is for,
  why it is flat, why it is allowed to sit under landed cost, and where the
  margin actually comes from (`PHOTOBOOK_PRINT_MARGIN`, 1.5x, on a live quote).
- Keep the measured basis paragraph. Keep `PHOTOBOOK_PRICING_VERIFIED` and what
  it means.
- Say what the 40 was chosen against, if anybody knows. If nobody does, say
  that instead of inventing a derivation — an honest "this number has not been
  re-derived since the split" is worth more than a plausible one.

**Not in this ticket.** No change to any number. This is words.

## Acceptance

- The comment above `PHOTOBOOK_BASE_CREDITS` describes the constant beneath it.
- No sentence in it refers to a per-page component or to 160 as the live value.
- `npm run verify` clean.
