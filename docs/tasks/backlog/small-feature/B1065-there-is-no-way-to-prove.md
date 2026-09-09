---
id: B1065
title: There is no way to prove that somebody holds the telephone number they typed
type: FEATURE
priority: high
complexity: medium
area: auth, otp, sms, whatsapp
found: "2026-09-09T07:11:55Z"
---

# B1065 — There is no way to prove that somebody holds the telephone number they typed

## Why

Nothing in this codebase has ever proven that somebody holds a telephone
number. `toE164` and `isMessageable` (`lib/whatsapp/phone.ts`) validate the
*shape* of one and say so in their own comments; a mistyped number simply
sends a family photograph to a stranger.

The mechanism to copy is right there. `login_codes` (`lib/db/schema.ts:79`)
stores a hash and never the code, supersedes the previous one on every fresh
request, expires in thirty minutes, and burns after five wrong guesses — with
every failure mode returning the same shape to the caller so nothing can be
distinguished by probing. `lib/mail/index.ts` and `lib/whatsapp/index.ts` are
both a transport interface, a dry-run backend that writes a file you can read,
and a real one, with no caller knowing which is in use.

So this ticket is a third transport of the same shape, and a `kind` on the
existing table. What it is not is obvious, and there are three candidate
channels with genuinely different costs:

| | |
| --- | --- |
| **SMS** | works for any number. Roughly CHF 0.06 to Switzerland at retail. Needs a provider account; needs no number of our own — an alphanumeric sender id is accepted for transactional traffic in Switzerland and most of Europe |
| **A WhatsApp authentication template** | around EUR 0.045 in Western Europe, so not the saving it is elsewhere. Needs Meta approval, a burnt-name-for-30-days hazard, and a recipient who has WhatsApp |
| **The person messages us first** | **costs nothing.** An inbound message proves the number by existing, and opens a free 24-hour window. It also lands them in the channel B1057 builds |

The third is the lazy answer and it is probably the right one, at least as the
first path offered: a `wa.me` link with a prefilled code, tapped from the
signup page. SMS is then the fallback for somebody who does not use WhatsApp,
and it is a fallback that costs money and therefore needs a ceiling.

## Work

- A `phone` kind on `login_codes`, with the same hash-only storage, TTL,
  attempt counter and supersession discipline. Do not invent a second store.
- A transport module shaped like `lib/mail/index.ts`: an interface, a dry-run
  backend that writes the payload it would have sent, a real one. A capability
  entry in `lib/capabilities.ts` naming its environment, off by default, and
  `/api/health` explaining what is missing.
- **Rate limits keyed on the number, not only the IP.** `lib/rateLimit.ts` is
  per-IP and in-process; a paid outbound message is a way to spend the
  operator's money from a phone on a train. Cap per number, per address and
  per day globally, and refuse rather than queue.
- Routes mirroring `app/api/auth/signup/{request,verify}` exactly, including
  the "always 202, never confirm whether it exists" discipline.

Not doing: choosing the provider (B1067), or what the proof is then used for
(B1064).

## Acceptance

A code proves a number, is single-use, burns after five guesses, and the whole
flow runs locally with no account anywhere — and a script cannot make the
instance send a hundred paid messages.

## Decided — 2026-09-09

Answered by the owner, walking the question book:

- **SMS, not an inbound WhatsApp message.** Rejected the free inbound-proof
  path deliberately: SMS works for somebody who has never used WhatsApp, and
  the web signup page is the primary door. This makes B1067 blocking rather
  than background — there is no provider account today.
- **Signup only, once, ever.** A number is proven at journal creation and
  never re-proven. **Login stays email passcode only** and the number is not a
  second factor. That is the decision that makes the cost small: one paid
  message per account for its whole life.
- **Ceilings**: 3 per number per day, 5 per address per day, **50 per instance
  per day** (roughly CHF 3 at Swiss retail). Refuse, never queue. The
  per-number and per-address keys matter because `lib/rateLimit.ts` is per-IP
  and in-process.
- The transport is still the `lib/mail/index.ts` shape — an interface, a
  dry-run backend that writes the payload it would have sent, a real one — and
  the whole flow must run locally with no account anywhere.

## Decided further — 2026-09-09

- **Email is proven first, then the number, and the journal is written last.**
  Today's flow is unchanged up to the signup token; the phone step is inserted
  before `createJournal`. Nothing is written until both are proven, so an
  abandoned signup leaves nothing behind — and, the reason it is this order
  rather than the reverse, **a bot has to pass the free gate before it can
  cost the operator an SMS.**
- **A failed delivery gets one resend, then an offer to correct the number.**
  Two attempts against the per-number cap of three, and then the person can
  fix a typo rather than being trapped on a number they mistyped — which is by
  far the commonest cause. No voice-call fallback in the first release; that
  is a second provider integration for a failure mode nobody has measured.
- **Test journals get a real code that is written to disk rather than sent**,
  so an agent driving a test signup on the server can read it — the same way
  OTP codes are already printed and mail is written under `<dataDir>/mail/`.

  **The reason this is safe is worth writing into the code, because the
  obvious objection is the right one to answer.** A caller who asks for a test
  signup is not skipping the proof; they are asking for the code to be put
  somewhere only the server's filesystem can reach. A stranger who passes the
  same flag gains nothing, because they cannot read the file. **The bypass is
  closed by construction rather than by a permission check** — which is the
  kind that does not rot when somebody refactors the gate.

  Two things to get right anyway: the code must be a real, single-use,
  attempt-limited code with the same TTL as any other (not a fixed string),
  and the journal must still be named `test-<something>` per AGENTS.md, so it
  is deletable by anybody who finds it later.
