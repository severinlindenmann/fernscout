---
id: B1795
title: A photo description spend is not refunded when every photograph fails to resize
type: ISSUE
priority: medium
complexity: low
area: credits, helper, photos
found: "2026-09-15T10:35:19Z"
---

# B1795 — A photo description spend is not refunded when every photograph fails to resize

## Why

`app/api/helper/[user]/day/describe-photos/route.ts` charges before it calls the
model and refunds when the call throws — the right order, and the reason is
written down there. But there is a third path it does not cover.

The route builds a `sendable` list by resizing each photograph. If **every**
resize fails, `sendable` is empty, `describePhotos` is never called, nothing
throws, and the handler returns normally with empty captions — while the spend
has already succeeded. The person is charged for a request that described
nothing, and no refund fires because no exception was raised.

Found during the security and quality review of B1751's camera-roll import,
which copied this route's spend/refund shape deliberately rather than inventing
a third policy. The copy at `app/api/helper/[user]/extract/enrich/route.ts`
therefore inherits the same gap. **Neither is new** — this is the original
route's behaviour and the reviewer was explicit that the branch introduced
nothing here — which is why it is a backlog ticket rather than a fix on that
branch.

How likely the trigger is has not been measured. A whole-batch resize failure
needs something systemic — a disk problem, a permissions change, a corrupt
originals directory — rather than one bad file, since a single failure just
drops that photograph from the batch. Rare, but the failure mode is "took money,
did nothing", which is the kind that should not depend on rarity.

## Work

Refund when the model was never asked anything. The check belongs after
`sendable` is built and before the model call: if there is nothing to send, the
work cannot happen, so the charge should not stand.

Fix it in **both** routes, and keep them the same shape — they are deliberately
copies of one policy, and a fix in one that does not land in the other is how
they start to drift.

Consider whether the honest answer is a refund or refusing to spend at all when
`sendable` is empty. Refusing first is the smaller change and never moves money;
refunding is more consistent with how the throw path already reads. Either is
defensible, but do the same thing in both places.

## Acceptance

- A `describe-photos` request where every photograph fails to resize leaves the
  owner's balance unchanged. A test drives that — mock the resize to fail for
  every item and assert on `balanceOf`, not on the response shape.
- The same test exists for `extract/enrich`.
- The two routes still express one policy; a reader can tell they are the same
  rule in two places.

## Related

Found reviewing B1751. The camera-roll import inherited this from
`day/describe-photos` by copying it on purpose; the copy is not the defect.
