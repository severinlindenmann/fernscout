---
id: B463
title: The credits card prices a send but not a postcard, does not total a day, and offers no way to mute a channel
type: FEATURE
priority: medium
complexity: low
area: credits, me page
found: "2026-09-05T13:06:35Z"
---

# B463 — The credits card prices a send but not a postcard, does not total a day, and offers no way to mute a channel

## Why

The Guthaben card on `/<user>/me` (`MePageContent.tsx:600`) answers "what would
one send cost" per channel and stops there. Three things the owner standing in
front of it actually wants are missing.

**It never prices a postcard.** `POSTCARD_CREDITS` is 15 — the largest single
thing a balance is ever spent on, and the only one that costs real money at a
printer — and the one panel about credits does not mention it. An owner with
250 points has no way to know from this card whether that is sixteen cards or
two hundred and fifty.

**It never adds the two rows up.** The card gives "up to 2" and "up to 1" and
leaves the owner to do the arithmetic on the only question they asked: what
does publishing a day cost me right now. That is the number, and it is the one
number not on the card.

**And there is no way to stop spending.** `features.mail` is B60's mute button
and `features.whatsapp` is the same switch for the other channel, but the only
way to press either is `PATCH /api/v1/<user>/config` — an agent token, which
means asking an agent to do it. The person looking at a balance they are
watching go down is exactly the person who wants to mute a channel, and they
are already signed in as the owner on this page.

That last one is the reason this is a ticket rather than two lines of copy. The
route comment on `/config` says "this is not a settings page, and there will not
be one", and this does not become one: it is two switches over the two
capabilities that *spend the balance the card is about*, next to the balance,
and nothing else about the journal is editable here. Turning a channel off is
narrowing, which `setJournalFeatures` already allows without asking the server;
turning it back on is refused by the same ceiling as everywhere else.
Transactional mail is unaffected — `sendTransactional` is deliberately not
suppressible by a journal's mail switch — so muting mail cannot lock its own
owner out.

## Work

- `lib/credits/pricing.ts` already exports `POSTCARD_CREDITS`; the panel says
  what a card costs, where `postcards` is on.
- A total row: what one published day would cost right now, which is the
  channels that are actually on.
- Two switches, one per channel, `POST /api/v1/<user>/channels`, owner cookie —
  the same `isOwner(user, request)` gate `credits/purchase` uses, and
  `setJournalFeatures` underneath, so the ceiling and the file-restore
  behaviour are the ones that already exist.
- A channel the *server* does not offer has no switch and no row: that is not
  a state an owner can change. A channel the server offers and the journal has
  off is a switch that is off, and its cost is zero.

Not doing: any other capability, and anything about a trip. Postcards are
priced here, not sent here — that is the preview page and B434's button.

## Acceptance

- The card names the postcard price, totals a day's send, and the total falls
  to zero when both channels are muted.
- Muting mail from this card leaves sign-in codes working.
- A journal on a server with WhatsApp off shows no WhatsApp switch.
- `npm run verify`.
