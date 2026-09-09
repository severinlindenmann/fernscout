---
id: B1113
title: /api/health cannot say whether this instance actually prints photobooks
type: ISSUE
priority: medium
complexity: low
area: capabilities, photobook
found: "2026-09-09T16:30:00Z"
---

# B1113 — /api/health cannot say whether this instance actually prints photobooks

## Why

`dryRunNote` (lib/capabilities.ts:197) covers both printing capabilities while
the provider is `dry-run`, and then returns early for photobooks:

```ts
if (name !== "postcards") return undefined;
return feature.live === true
  ? `features.postcards.live is true — ${provider} PRINTS AND POSTS real cards, and real money moves`
  : `features.postcards.live is not set — …`;
```

So a photobook capability with `provider: "gelato"` reports `{"enabled": true}`
and nothing else, whether `live` is true or not. The two states that differ by
real money and real paper are indistinguishable from outside.

That is exactly the question B435 added the postcard note to answer, in its own
words: whether the instance is really posting things "must be a question
/api/health answers rather than one somebody guesses at from a deploy log".
The reasoning is identical one supplier along, and a photobook is the more
expensive object.

Found while switching fernscout.ch to `provider: "gelato"`, `live: true` on
2026-09-09: the only confirmation available was the *absence* of the dry-run
note, which is a much weaker signal than the one postcards gives — and it reads
identically on an instance where `live` was forgotten.

## Work

- Drop the `if (name !== "postcards") return undefined;` line and word the
  remaining branch for both names: `live: true` says this provider prints and
  posts real books and real money moves; absent says the order is validated and
  nothing is printed.
- Gelato's own word for the not-live state is a **draft** order
  (`orderType: "draft"` — lib/photobook/gelato.ts:59), which is validated and
  never charged. Say that, rather than borrowing the postcard wording about a
  free sample, which is a different mechanism.
- Not doing: any change to what is actually submitted. `isLive` already decides
  that correctly; this is only about what health reports.

## Acceptance

- With `provider: "gelato"` and `live: true`, `/api/health` names the live state
  in the photobook note.
- With `provider: "gelato"` and no `live`, it says the order is validated as a
  draft and nothing is printed.
- `dry-run` is unchanged.
- `npm run verify`.
