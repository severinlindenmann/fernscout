---
id: B821
title: Credits and storage are buried on the account page with everything else
type: FEATURE
priority: medium
complexity: medium
area: account, credits, storage
found: "2026-09-07T17:40:00Z"
started: "2026-09-07T15:37:13Z"
merged: "2026-09-07T16:16:28Z"
---

# B821 — Credits and storage are buried on the account page with everything else

## Why

Asked for: *"move Guthaben and Speicherplatz together on their own page and
menu point."*

Both live on `/[user]/me` today (`app/[user]/me/MePageContent.tsx`), stacked in
among the owner's contact details, the journal's title and tagline, the device
list and the access panel. They are the two questions an owner asks
repeatedly and urgently — *how much can I still spend* and *how much room is
left* — and they are the two that answer with a number rather than a form.
Reaching them means scrolling past everything else on the one page that holds
everything else.

They also belong together in a way the rest of that page does not: since B661
storage is bought *with* credits, 5 GB at a time. Two readings of the same
account, on one page, is the shape.

## Work

- A page of their own under `/[user]/`, and a destination in `useNavEntries()`
  (`components/SiteNav.tsx`) so it is reachable from the menu like the others.
- Move the credits panel and the storage panel off `/me`, do not copy them —
  two live copies of a balance is how they disagree.
- Leave a way through from `/me`, since that is where people have learnt to
  look. A line and a link, not the panels again.
- Owner-only, the same gate `/me` already uses. `credits` is an operator-level
  capability (`lib/capabilities.ts`) and may be off: with it off the page shows
  storage alone rather than a broken half.
- Both figures already exist behind `GET /api/v1/<user>/status` and
  `.../storage`; read them the way `/me` does rather than inventing a route.

Not doing: changing what a credit costs, the buying flow, or the quota rules.
This is where the two panels live.

## Acceptance

- The nav has a destination that opens a page carrying both figures.
- `/me` no longer renders either panel, and still points at them.
- With `credits` off, the page is storage alone and nothing is broken.
- A reader who is not the owner cannot open it.
- Checked at 390px.

## Done

New page `/[user]/account` (`app/[user]/account/page.tsx` +
`AccountPageContent.tsx`), owner-only via `isOwner()` +
`notFound()` — the same choice `/me/analytics` (B566) made, and for
the same reason: a 404 tells a stranger nothing, a 403 would tell them
this page exists. Storage and payment resolution moved there
unchanged from `app/[user]/me/page.tsx`; `MePageContent.tsx` lost the
`ChannelSwitch`/`BuyStorageButton`/`CleanupButton`/`StorageBar`/`BuyCreditsDialog`
subcomponents and the `StoragePanel`/`PaymentPanel` types along with
them — they moved whole to `AccountPageContent.tsx`. `/me` now has one
small card ("Credits & storage" / `me.accountCardTitle`) with a line
(`me.accountCardBody`) and an "Open" link to `/account` — never the
figures again.

**New nav destination and how it is gated.** `SiteSummary` gained
`isOwner: boolean`, resolved in `app/[user]/layout.tsx` the exact way
`signedIn`/`hasIdentity` already are (via `resolveAccess`/`isOwner()`
from `lib/contacts/session.ts`), so `useNavEntries()` can decide
client-side whether to draw the row at all — absent for anybody but
the owner, the same "absent rather than broken" rule `analyticsEnabled`
and `canSignIn` already follow.

**A refactor the ticket didn't ask for, but the wording ("a destination
in `useNavEntries()`") invited, and B823 needed anyway:** `SiteNav.tsx`'s
inline `LINKS` array (Story/Gallery/Map/Analytics) moved to a new
`lib/navDestinations.ts` (`TRIP_DESTINATIONS` + `ACCOUNT_DESTINATION`),
so B823's search-index builder could read the same list rather than
inventing a second one. `SiteNav.tsx` now imports it and maps icons by
path locally.

Measured headless at 390×844, signed in as the demo journal's owner
(`agent@fernscout.ch`, via the one-click sign-in link's redemption
button, per test-in-a-browser): the mobile panel gains an "Account" row
(48px) after "Your access"; `/example/account` renders the Storage card
(bar, cleanup/buy buttons) and the Payment card (balance, channel
switches, buy-credits dialog) exactly as they looked on `/me` before.
Screenshots taken and read back.

One thing the ticket didn't anticipate: with neither `storage` nor
`payment` present (no ceiling configured *and* credits off), the page
would have shown two empty slots. Added a fallback paragraph
(reusing `me.accountCardBody`) so the page never renders nothing at
all — not asked for, but "with credits off, the page is storage alone"
implied there is always *something* to show.

Tests: `test/access-panel.test.tsx`'s payment/storage describe blocks
moved to a new `test/account-page.test.tsx` targeting
`AccountPageContent` directly (the gate is server-side now, not the
component's concern); `test/access-panel.test.tsx` gained a small
"the account card" block asserting the line-and-link shows for the
owner and is absent for a stranger; `test/site-nav.test.tsx` gained
"the account destination" asserting the nav row's presence/absence and
its journal-base URL even inside a trip.

Committed as `2cfd6a42 B821: credits and storage get their own page
and menu point` (plus a one-line fixup,
`ded5b85b`, for a pre-existing exact-key-list test in
`test/access-door.test.ts` that had not caught up with the new
`isOwner` field).
