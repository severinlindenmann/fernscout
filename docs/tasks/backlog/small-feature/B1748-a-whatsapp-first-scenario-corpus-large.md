---
id: B1748
title: A WhatsApp-first scenario corpus large enough to find what one person's testing cannot
type: FEATURE
priority: high
complexity: medium
area: whatsapp, helper
found: "2026-09-14T19:41:28Z"
---

# B1748 — A WhatsApp-first corpus large enough to find what one person cannot

## Why

Every conversational defect this repository has fixed was found the same way:
the owner hit it, live, and reported it. B1736, B1737, B1742 and B1743 were
all one person's Sunday afternoon. That does not scale and it is not fair on
the person — by the time they find it, it has already happened to them.

B1744's corpus has five scenarios. The gap between that and what the product
actually does is most of the product.

**WhatsApp first, deliberately.** It is the door the owner uses, it is the one
with no screen to correct a mistake on, and it is the weaker of the two: the
person cannot see a files pane, cannot edit a proposal's fields, and a wrong
answer costs a round trip through a messenger rather than a glance.

## Work

Build the corpus on B1747's expansion, so this is a hundred-plus cases from
perhaps twenty readable blocks. Cover, at minimum, what the channel really
does:

- **Days** — a note about a day, a note with no date, two days in one message,
  a day that already exists, a correction to one just written.
- **Photographs and voice** — an image with a caption, several at once, a voice
  note, a document, a location pin, a contact card.
- **People and access** — a contact card to a trip, to a reading invitation,
  someone named but not shared, revoking.
- **Money** — a cost with a currency the trip has no rate for, a cost with no
  day, a budget.
- **Refusals that must hold** — invented weather, publishing without being
  asked, a postcard, buying credits, anything deletion-shaped. These matter
  more than the happy paths: a wrong refusal is an annoyance, a missing one
  is somebody's journal.
- **The channel's own mechanics** — the typed press (B1743), the button press,
  a second proposal, "neues Gespräch", a message after the 24-hour TTL.

Then the same treatment for `/agent`, where the files pane and an editable
card change what the model should do.

**Hungarian is missing on purpose.** The wordings must be written by somebody
who speaks the language; inventing them would put a sentence in the corpus
that no Hungarian speaker has read, and the corpus is the thing everything
else is measured against. Leave `hu` out and say so until somebody can write
it.

## Acceptance

- At least 100 cases, the majority on WhatsApp, each traceable to something
  the product really does.
- A baseline recorded, and the weak scenarios named rather than averaged away.
- Every refusal scenario passes, or its failure is a filed ticket.
