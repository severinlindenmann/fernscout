---
id: B1269
title: The low-credit warning's Buy credits link goes to a page with no credits and no way to buy
type: ISSUE
priority: medium
complexity: low
area: helper, credits
found: "2026-09-10T10:11:02Z"
---

# B1269 — The low-credit warning's Buy credits link goes to a page with no credits and no way to buy

## Why

The coral banner in the helper room ends in a link:

> Your credits are nearly used up — about ten more written days. **Buy credits**

`components/HelperRoom.tsx:1029` sends it to

```tsx
href={`/${encodeURIComponent(username)}/me`}
```

`/<user>/me` is **"Your access"**. On the live instance the word *credit* appears
on it exactly once, in the opening sentence — *"…hand an agent the keys, keep an
eye on your credits, and choose who reads along."* There is no balance on the
page, no price list and no way to buy anything.

The page that has all three is `/<user>/account` — **"Credits & storage"** —
which opens on the storage bar, the balance, what a send costs, and the purchase
path. The helper's own header pill goes to the right place: its `aria-label` is
"Credits & storage" and it opens the account sheet. The banner is the one link
that does not.

So the single call to action attached to the alarm every new journal sees
(B1251) lands somewhere that cannot answer it, on a page that then *mentions*
credits without showing any — which reads as though the feature is missing
rather than as though the link was wrong.

## Work

- Point the banner where the pill already points.
- While you are there: `/<user>/me` promises "keep an eye on your credits" and
  cannot deliver it. Either drop the clause or link it.

## Acceptance

- Tapping **Buy credits** in the helper lands on the balance.
- No page says "keep an eye on your credits" without showing them or linking to
  them.
