---
id: B315
title: The invite form offers a postcard but never asks about email updates, so a new reader is silently opted out
type: ISSUE
priority: medium
complexity: low
area: contacts, invites
found: "2026-09-04T16:49:39Z"
related: B273
started: "2026-09-04T19:14:57Z"
merged: "2026-09-04T19:20:58Z"
completed: "2026-09-04T20:01:42Z"
---

# B315 — The invite form offers a postcard but never asks about email updates, so a new reader is silently opted out

## Why

Reported by the owner on 2026-09-04, looking at a live guest invite page
(`/viki/invite/guest/<token>`). The brand-new-reader form ends with one
checkbox — "Send me a real postcard from the road" — and there is no
"Send me an email when there are new days to read" beside it.

That is the wrong half to be missing. The postcard is the rarer, more
involved thing; the digest is the one a guest of a travel journal actually
expects, and it is the only thing that ever tells them a new day is up.

It is not merely absent from the screen — it is **answered for them, as no**:
`app/api/contacts/redeem/route.ts:228` writes
`wantsEmailDigest: known?.wantsEmailDigest ?? false`, and for a brand-new
reader there is no `known`. So somebody who follows an invite, proves their
address and is approved gets nothing, ever, unless they later find the manage
link at the bottom of a mail and tick a box they were never shown. The
guestbook form (`components/ContactForm.tsx:74`) defaults the same choice to
**ticked**, so the two front doors into the same contacts table disagree about
what a reader wanted.

The gap has a clear cause. B33 built `InviteRedeem` to ask a **returning**
reader nothing beyond identity — "no digest tick, and no postal address
either" — so that a redemption can never quietly rewrite a choice somebody
already made. Correct, and still correct. B273 then carved out the case that
reasoning does not cover: a **brand-new** reader has no existing choice to
overwrite, only a first one to make, and gave that step the address, the phone
number and the postcard box. The digest tick belongs in that same carve-out
and was not carried across; `components/InviteRedeem.tsx`'s doc comment still
says "no digest tick" as though the returning-reader rule were the whole
story.

## Work

Everything needed exists: `contact.wantsDigest` is a `TranslationKey` with
en/de/hu translations (`content/locales/*.json:121`), and `requestContact`
already takes `wantsEmailDigest`.

- **`components/InviteRedeem.tsx`** — add a `wantsDigest` checkbox to the
  "form" step only, beside the existing postcard box, using
  `t("contact.wantsDigest")`. Copy `ContactForm.tsx:344-358`'s two-box block,
  including its comment: two questions with different consequences, never
  answered at once. Send `wantsEmailDigest` in the request body inside the
  same `...(knownEmail ? {} : { … })` spread the address already uses.
- **The "confirm" step stays untouched.** An already-known reader is shown no
  box and answers nothing — the B33 rule this ticket is not reopening.
- **`app/api/contacts/redeem/route.ts`** — read the flag only when
  `!sessionEmail`, gated the way `addressProvided` is (`:200-201`) rather than
  on the body carrying it, because the client is not the boundary. Keep
  `known?.wantsEmailDigest ?? false` as the fallback for every other path, so
  a returning reader's stored choice is still never rewritten.
- **The default is ticked** — the owner's decision, 2026-09-04, asked
  directly. It makes the two front doors agree, and `ContactForm` already
  ticks it. What makes it defensible rather than merely convenient is that
  nothing is sent on the strength of the tick alone: the address still has to
  be confirmed by code and then approved by the owner before a single digest
  goes out (see the note below), and every digest already carries a one-click
  unsubscribe. A pre-ticked box that cannot by itself cause mail is a default,
  not a consent dark pattern.
- **The box is shown unconditionally**, also the owner's instruction: it
  appears on the form step whether or not this reader has an address on file
  yet, which is the same thing `ContactForm` does. So the "not in scope" note
  below is settled in the direction of showing it.
- **Update the doc comments** in both files: three now assert "no digest tick"
  as a flat rule (`InviteRedeem.tsx:14`, the redeem route's `:36-38`), and
  after this they are wrong for the form step in exactly the way they were
  already wrong about the address before B273 corrected them.
- Not in scope: whether the box should hide itself when the journal has the
  digest capability off. `ContactForm` shows it unconditionally and so does
  this, per the decision above; if that is wrong it is wrong in both places
  and is its own capture.

**Two things the owner asked for that turned out to exist already**, checked
on 2026-09-04 rather than assumed, and recorded here so nobody builds them
twice:

- *Every update mail must let the reader unsubscribe.* It does.
  `lib/digest/index.ts:391` passes `unsubscribeUrl` into every digest, and
  `lib/mail/template.ts:145-149` renders it as a footer link **and** sets
  `List-Unsubscribe` with `List-Unsubscribe-Post: One-Click`.
- *Never mail somebody who has not verified their address.* It holds for the
  digest: `lib/digest/index.ts:197` requires `status === "active"`, and
  `approveContact` (`lib/contacts/index.ts:684`) returns null without
  `confirmedAt`, so an unconfirmed address cannot reach `active` and therefore
  cannot be sent a digest. The DB column already exists — `contacts.confirmed_at`.
  What does *not* exist is any single place enforcing that rule, so it holds
  because five senders each happen to be correct. That is **B334**.

## Acceptance

- A brand-new reader redeeming a guest link sees both boxes, and the choice
  they make is what `contacts` stores — a test asserting `wantsEmailDigest`
  true and false from the two paths, not just that the markup renders.
- A reader redeeming with a session, or with an email already on file, is
  shown no box and has their stored `wantsEmailDigest` left exactly as it was
  — including when a hand-built request body sends one.
- `npm run verify`.
