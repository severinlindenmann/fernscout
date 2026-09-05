---
id: B90
title: A journal can only reach its readers by email or push, and neither is where most people are
type: FEATURE
priority: low
complexity: high
area: whatsapp, notifications, credits
found: "2026-09-03"
superseded: "B365 — the WhatsApp channel was built; B366 metered it"
---

# B90 — A journal can only reach its readers by email or push, and neither is where most people are

## Why

> **Superseded, 2026-09-05.** B365 built this: `lib/whatsapp/` (Cloud API,
> template send), an explicit `wantsWhatsapp` consent beside the digest and
> postcard consents (`lib/contacts/index.ts:69`), and a send wired to
> `POST .../days/<slug>/publish`. B366 put it behind the credits ledger, so
> it is metered as this task asked. What is left is filed on its own: B403
> (never delivered a real announcement), B386 (no way to stop from inside
> WhatsApp), B378, B389, B372.

A journal has two ways to tell a reader something new is up: the email digest
(`lib/digest/`, ROADMAP D2, "the only notification channel that reaches
everybody") and web push (`lib/push.ts`, "the bonus"). Email lands in a folder
nobody opens on holiday; push needs the reader to have installed the site as an
app. The channel most of these ~20–50 readers actually live in — WhatsApp — is
not reachable at all.

The ask is a WhatsApp Business channel: when a day is published, message the
readers who have a number on file and have agreed to it, with the post's text,
its images, and a link to the post. Off by default, toggleable per journal. And
because Meta bills per conversation, it is metered — which is why this is a
consumer of the credit system (B89), not a free channel.

Three things make this genuinely hard, and the task should not pretend
otherwise.

**Consent is not "has a phone number."** The contacts model already holds a
`tel` inside the encrypted address blob (`lib/contacts/crypto.ts:34–44`), and it
is deliberately *not* part of `isPostable` — a number is not somewhere to send a
card. It is also not, today, somewhere to send a message: there is no
WhatsApp-opt-in field, and reusing "they gave a number" as consent to be
messaged is exactly the kind of silent repurposing the encryption comment warns
against. WhatsApp opt-in is its own consent, captured explicitly, revocable from
the same manage link every mail footer carries (`manageTokenFor`,
`lib/contacts/index.ts`), and stored beside the digest and postcard consents
(`wantsEmailDigest`, `wantsPostcard`, `lib/contacts/index.ts:62–63`) rather than
inferred.

**WhatsApp Business is not "POST a message."** Outside a 24-hour customer-service
window, Meta only allows *template* messages — pre-approved, with the free text
in named variables — and each opens a billed conversation. A journal update is
almost always outside any window, so this is a template flow: a submitted,
approved template with slots for the post title, an image and the link. The task
must model that, not assume arbitrary text sends. Read Meta's Cloud API before
designing the payload; it is not like the print providers.

**It costs money per send.** So it goes through the credit ledger (B89):
messaging N readers debits N sends' worth of credits, refuses when the balance
is short with a message naming the balance and the cost, and — like the digest —
records each send *before* the transport is called so a crash loses at most one
reader's message and never double-charges (`lib/digest/index.ts:13–20` is the
model to copy).

## Work

Depends on **B89** (the credit ledger) — do not build a second metering scheme
here. If B89 is not done, this task is blocked; say so and stop rather than
inventing credits inline.

Follow the shape the digest already sets, because it solved these problems once:

- **A provider module** — `lib/whatsapp/`, mirroring `lib/postcard/providers.ts`
  and `lib/photobook/providers.ts`: a `dry-run` backend that writes the composed
  message to a file under `content/<user>/`, and a real backend behind
  `WHATSAPP_*` env (token, phone-number id, template name). Secrets are
  environment only, never `content/config.json` (`lib/capabilities.ts`, and the
  house rule). A capability entry, off by default, absent-not-broken when off.
- **A consent field** on the contact, captured explicitly and revocable, stored
  next to the other consents. Migration in `lib/db/`. Do not backfill it from
  existing phone numbers — that would opt people in without asking.
- **A plan/run split**, exactly like `planDigest`/`runDigest`: `plan` decides who
  is eligible (approved, opted in, has a number, journal has the toggle on) and
  writes nothing, so `--dry-run` is the real path; `run` debits credits and
  sends, recording before transport. Reuse `lib/digest/visibility.ts`'s rules —
  a reader must not be messaged about a trip they cannot read, the same bug B68
  was for push.
- **The per-journal toggle**, in the journal's `config.json` features block,
  respecting the server ceiling (a user config may narrow a capability, never
  widen it — `lib/config.ts:96`).
- **The message itself**: title, a representative image, and the post link
  (public URL; never a draft, and never something the reader cannot open).

## Acceptance

- With the capability off (default), nothing WhatsApp appears anywhere and
  `/api/health` explains why; every existing flow is unchanged.
- A contact can opt in to WhatsApp and opt back out from their manage link;
  opt-in is never inferred from a phone number being present.
- Publishing a day (a deliberate act — not an automatic side effect unless the
  person asks for it) can message opted-in readers with the post's title, an
  image and a link, and skips anyone who cannot read that trip.
- Each message debits credits once, a short balance refuses with the balance and
  cost named, and a crash mid-run neither double-sends nor double-charges.
- `--dry-run` writes the exact messages a real run would send, to files, calling
  no provider.
- `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`, `npm run build`, dev
  server boots with the capability on and off.
