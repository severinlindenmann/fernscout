---
id: B1005
title: The preview page does six jobs at once, and only fits a phone
type: FEATURE
priority: high
complexity: medium
area: Postcards
found: "2026-09-08T18:05:00Z"
started: "2026-09-08T17:42:59Z"
session: b8352d66-3105-4f5d-a703-f8809d0b08e6
claimed: "2026-09-08T17:42:59Z"
---

# B1005 — The preview page does six jobs at once, and only fits a phone

## Why

`/<user>/postcards/<id>` asks for six unrelated things in one column: where the
photograph is cropped, what the card says, who it is signed by, which language
it is in, whether the figures print, and then — under two warnings and a list of
addresses — whether to spend the credits. On a phone that is one long scroll
where the thing you came to do is at the bottom. On a desktop it is the same
column with 900px of cream either side of it: the page has no wide layout at
all, only `sm:grid-cols-2` on one row.

Three more things the flow gets wrong, each cheap to fix once the page is in
steps:

- **The message is asked for twice.** `PostcardSheet` takes it, then
  `PostcardBack` asks again on the next screen. Nobody can tell which one is
  the real one; the second is.
- **The low-resolution warning arrives too late.** `resolutionNote` is computed
  on the preview, two screens after the photograph was chosen, and swapping it
  means abandoning the order.
- **The people are frozen at creation.** The page lists them and says changing
  them means a new order — after the writing is done. `payload.recipients` is
  only read at send, so nothing about a draft actually requires this.

Chosen from four directions the owner was shown (the artifact behind B982's
follow-up): direction A, "one page, three steps".

## Work

**Three steps on the one page** — Look, Write, Send — as a client component
that owns the step and takes the three panels as children, so the page stays a
server component and every existing piece (`PostcardCropper`, `PostcardBack`,
`PostcardSend`) is reused rather than rewritten.

**With JavaScript off, all three panels render stacked**, which is today's page.
The stepper is an enhancement applied after hydration, never the only way
through — the same rule the send button has carried since B466.

**A desktop layout, not a stretched phone.** The step panel is centred and
capped; `PostcardBack` lays the card and its form side by side from `lg`.

**The message is asked for once**: the composer sheet stops carrying a textarea
and says where the words start and where they get written.

**The recipients become editable** while the order is a draft, through a route
in the same family as `/message` and `/crop` — owner cookie, no bearer token,
draft only, and every id checked against `postcardCandidates` so a card can
still only go to somebody who asked this journal for one.

**The message box gets bigger**, because a postcard is 600 characters and the
box was four rows.

Not doing: per-recipient messages (that was direction C and it changes the
order model), the flippable card (direction B), and anything to the send
mechanics, which B982 has just settled.

## Acceptance

- The page shows one job at a time, with a bar that says which of the three you
  are on and lets you go back.
- With JavaScript disabled every panel is present and the flow still completes.
- At 1280px the card and its form sit side by side and nothing is a lone column
  in a wide window; at 390px it is one column.
- The composer sheet has no message field, and the words it starts from still
  arrive on the card.
- Adding and removing a recipient on a draft changes the price on the send box
  without a page load, and is refused once the order has left `draft`.
- The message box is at least eight rows.
