---
id: B1270
title: The account page quotes send prices for nought people and offers to sell 5 GB to a journal using one kilobyte
type: ISSUE
priority: low
complexity: low
area: account page
found: "2026-09-10T10:11:45Z"
started: "2026-09-11T15:47:58Z"
session: 13f12910-ff28-4566-894a-9e2b3d055281
claimed: "2026-09-11T15:47:58Z"
---

# B1270 — The account page quotes send prices for nought people and offers to sell 5 GB to a journal using one kilobyte

## Why

`/<user>/account` on a journal one day old, at 390px:

> **Storage** — 1 KB of 5.0 GB used
> ● Everything else 1 KB   ● Bern Weekend 0 KB
> **[ Add 5 GB for 50 credits ]**
>
> **Payment** — 9 CREDITS
> WHAT ONE SEND WOULD COST NOW
> ✉ Email — up to **0 people** · free                    [toggle, on]
> 💬 WhatsApp — up to **0 people** · **0 credits**       [toggle, on]
> One published day — 0

Three separate things are being reported about nothing:

- A **two-slice breakdown of one kilobyte**, with a legend, under a bar that
  cannot render 1 KB of 5 GB as anything but empty.
- An offer to **sell 5 GB for 50 credits** — five times the whole signup grant —
  to somebody using 0.00002% of what they already have. On a balance of 9 it is
  also unaffordable, so the button is an advertisement that cannot be taken up.
- A **price list for sending to nought people**, with two toggles switched on
  and a "0 credits" quote, on a journal that has no readers yet.

This is the same shape as B1260 on the trip page: every module renders in full
ceremony whether or not it has anything to say, and the state it looks worst in
is the one every new journal starts in. It is the second page a person reaches
from the helper's own credit warning, so it is on the path B1269 describes.

## Work

Built in `app/[user]/account/page.tsx` and `AccountPageContent.tsx`, on
branch `b1258-ui-remainder`.

- **The price-list third of this ticket was already fixed before it landed
  in development.** `AccountPageContent.tsx:613` now reads
  `CHANNELS.some(({ recipients }) => recipients > 0) ? <itemised list> :
  <p>{t("me.paymentPrices")}</p>` — a September 10 change to the account page,
  after this ticket was filed. "up to 0 people · 0 credits" no longer renders;
  a journal with no readers instead gets one generic pricing sentence. Left
  alone as instructed. It does not add the invitations link the ticket's Work
  section suggested — the fallback sentence names no next action — but that is
  a smaller, separate polish and not what was broken.
- **Storage breakdown floor**: `app/[user]/account/page.tsx` now computes
  `percent` once and only builds `storage.rows` when `percent > 0`.
  `AccountPageContent.tsx`'s `<StorageBar>` is skipped entirely when
  `rows.length === 0`. No new threshold invented — `percent` is the same
  rounded number the page already prints in words a line above
  ("1 KB of 5.0 GB used"), so a journal at 1 KB of 5 GB (which rounds to 0%)
  draws no bar and no legend at all, while a real, nonzero share still does.
- **Storage upsell threshold**: `canBuy` is now `creditsEnabled() && percent
  >= 90`, reusing the exact number `me.storageNearlyFull` already draws its
  own line at a few rows above (`AccountPageContent.tsx:807`,
  `storage.percent >= 90`), rather than picking a second number for the same
  question of "is storage actually tight". "Add 5 GB for 50 credits" no
  longer appears below 90% used.
- Verified with `test/account-page.test.tsx` and `test/storage-cleanup.test.ts`
  (32 tests, all pass).
- Not driven in a real browser: the account page is owner-only and reads a
  cookie session with no bearer-token path (per AGENTS.md), which needs a
  full sign-in flow to reach; verified by reading the two files and the
  passing tests instead.

## Acceptance

- A journal with no readers and no photographs shows no price quoted for nought
  people and no offer to buy storage.
- A journal with readers and content is unchanged.
