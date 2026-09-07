---
id: B595
title: A photobook can be charged a price the owner never saw
type: ISSUE
priority: low
complexity: low
area: photobook, credits
found: "2026-09-06T14:32:19Z"
started: "2026-09-07T11:40:40Z"
merged: "2026-09-07T12:18:36Z"
completed: "2026-09-07T13:12:17Z"
---

# B595 — A photobook can be charged a price the owner never saw

## Why

Found while working B482 (a photograph-less book paid for from a stale tab).
`app/[user]/photobook/order/route.ts` re-plans the book with `planFor` at Pay
time — `lib/photobook/build.ts:36` — and prices *that* result with `priceOf`,
line 104. The owner only ever saw the price `preview/route.ts` quoted, from a
plan made against whatever the trip looked like a debounce-cycle ago. Nothing
ties the two together: a trip that grew a day, or had photographs added to
one, between the last preview response and the Pay press is charged at the
new, larger figure with no chance to see it first — the same staleness window
B482 closes for photo count, left open for price.

Not a security hole and not usually large: the two requests are normally
seconds apart on one screen. It is still the owner's own money charged at a
number their own screen never showed them.

## Work

Not investigated further — this is a capture, not a design. Worth deciding
before building anything: whether the order form should carry the previewed
price and refuse (or re-confirm) when the freshly-planned one differs, or
whether re-planning at Pay is itself the bug and the order should build from
the exact plan the last preview produced instead of asking `planFor` again.
The second is the larger change — it means serializing a `Photobook` (or its
inputs) across the two requests rather than trusting `options` alone to
reproduce it.

## Acceptance

TODO — depends on the design decided above. At minimum: adding a day's worth
of photographs to a trip after previewing a book and before pressing Pay must
not silently charge more credits than the preview quoted.

## Triage / decision and what was built

Took the **first, smaller option**: re-planning at Pay time is not itself the
bug (`buildPhotobook` still needs to read the trip fresh to actually render
pages, and serializing a whole `Photobook` across two requests is real
complexity for a `priority: low` ticket) — the bug is that nothing compares
the two prices. So the fix is a freshness *check*, not a re-architecture:

- `BookLevelView.tsx`'s form gained one more hidden field,
  `previewedCredits`, set from the same `preview.credits` the price on screen
  already comes from.
- `app/[user]/photobook/order/route.ts` still calls `planFor`/`priceOf` (as
  before — it needs the real plan to build from regardless), but now compares
  the fresh price against `previewedCredits` **before** `claimOrder`,
  `buildPhotobook` or `spend` run. A mismatch — or a missing/non-numeric
  field — is a new outcome, `stale_preview`, and nothing is claimed, built or
  charged.

### What it costs in each failure case — this is money, so stated explicitly

- **Missing** (an old tab with no `previewedCredits` field, or a hand-built
  request): refused as `stale_preview`. **Cost: zero.** Nothing is claimed,
  built, or charged.
- **Stale** (the field is present but the trip changed since, so a fresh
  `priceOf` no longer agrees with it): refused as `stale_preview`. **Cost:
  zero.**
- **Does not match, in either direction**: same refusal whether the real
  price is now *higher* (a day/photograph added — the case in Why) or *lower*
  (something removed) than what was previewed. A lower current price is
  refused too, deliberately — the check is "does this match what was shown",
  not "is this now cheaper", so a request that never actually previewed
  (fabricating a low number) is refused exactly like a stale one rather than
  being honoured at the lower figure. **Cost: zero** in every case; the owner
  presses Pay again after the page's own preview effect quotes the current
  number.
- **Matches**: unchanged from before this ticket — the owner is charged
  exactly the number both requests agree on, in the same claim→build→spend
  order B509 established.

Never a guessed price is charged; the only two outcomes are "charge exactly
what was shown" and "charge nothing and ask to look again".

### Contract

Not an `/api/v1/**` route (`/[user]/photobook/order`, owner's own cookie
only, bearer explicitly refused, same as `preview`), so no `openapi.ts`
change applies — `test/openapi-contract.test.ts` only requires this for
`/api/v1/**` and `/api/auth/**`.

### Tests

`test/photobook-order-route.test.ts`, new
`describe("the previewed price must still hold at Pay time")`: a price that
grew between preview and press refuses (`stale_preview`) rather than
charging the new one and touches `claimOrder`/`buildPhotobook`/`spend` not at
all; a missing `previewedCredits` refuses the same way; a previewed price
*lower* than the real one is refused too (closing the "just send zero" hole);
and — the case that must still work — a previewed price that matches goes
through exactly as before, `spend` called with the same number. 12/12 in that
file pass, including the five pre-existing tests (updated only to add a
matching `previewedCredits` to the shared `orderRequest()` helper, since
without it every existing test would now hit the new refusal first).

### Not done

No UI copy beyond one new locale string (`photobook.stalePreview`, three
languages) and no re-fetch-and-retry affordance — the page already re-runs
`preview` on every options change (debounced), so reopening/adjusting the
form is enough to get a current, matching price; a dedicated "price changed,
click to refresh" button was judged unnecessary for a `priority: low` ticket
whose failure mode already self-heals on the next normal interaction.
