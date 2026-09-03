---
id: B142
title: A mail scanner follows the welcome link, spending the owner's one-tap sign-in and minting a year-long session
type: SECURITY
priority: high
complexity: medium
area: auth, mail, onboarding
found: "2026-09-03"
started: "2026-09-03T19:48:54Z"
session: ea97c35d-5c6a-4610-ab68-d1575d52ea4f
claimed: "2026-09-03T19:48:54Z"
---

# B142 — Something at the recipient's mail host follows the sign-in link

## Why

Observed on the live instance, not inferred. Three journals were created on
2026-09-03 at 17:43–17:44 UTC, each mailing its owner a standing sign-in link.
**All three links were redeemed at 17:59, by something that was not a person**,
before any human or agent had opened them:

```
login_codes.link_consumed_at   xydhd-qa3  17:59:11.625
                               xydhd-qa2  17:59:23.913
                               xydhd-qa1  17:59:35.205
```

Twelve seconds apart, in descending order of creation — a sweep. Each
redemption minted a session:

```
sessions   xydhd-qa1 | guest | read | created 17:59:35.218 | expires 2027-09-03
```

The mails went out over real SMTP (`journalctl`: `[mail:smtp]
xydhd-qa1@severin.io — "Your journal is ready — QA one" -> 2.0.0 Ok: queued as
4hbRlY3gxQz2ScXF`), so the likeliest actor is a scanner or link-prefetcher at
the receiving mail host. This is the exact scenario **B27's own Why section
anticipates**, now confirmed happening in production.

Two distinct costs, and the second is the reason this is filed as SECURITY:

- **The feature does not work for real recipients.** The one-tap link is the
  first thing the software says to a new owner, and it is dead before they
  reach it. A person clicking the button in their own welcome mail gets
  `303 -> /<user>/me?signin=expired`. That was observed too. On this instance
  the onboarding path has a 100% failure rate for mail delivered to a scanning
  host — three of three.
- **A machine holds a read session for a private journal, valid for a year.**
  The scanner receives a `Set-Cookie: fs_session=fs_guest_…; Max-Age=31536000`
  and whatever holds that cookie can read every `guest` trip in the journal for
  twelve months. A scanner almost certainly discards it, but the session exists
  server-side either way and nothing revoked it. The mail host could already
  read the mail, so this is not a new party gaining the link — it is an
  automated fetch being converted into a durable credential.

The standing link is deliberately permanent (`lib/auth/index.ts:550` skips the
expiry check when `link_standing === 1`), which is what makes the failure
absolute: the link cannot outlive the scanner by simply not expiring, because
being spent is the terminal state.


## Scope, narrowed by B29's verification (2026-09-03)

This affects the **standing** link that goes in the welcome mail, and not the
**relay** link the journal-creation API returns as `signIn`. They are different
tokens against the same door — `issueStandingLink` and `issueRelayLink`,
`lib/auth/index.ts:466` and `:432` — stored as separate `login_codes` rows.
Redemption consumes only the row it matched and `openSession` revokes nothing,
so a scanner sweeping the inbox spends the mailed copy and leaves the relayed
copy live. Confirmed on `xydhd-qa5`: the 201 carried `…/s/S0P6FxUm…` while the
welcome mail written three seconds later carried a different token.

That matters for the fix. **Whatever is done here must not break the relay
link**, which works correctly today: short-lived, single-use, handed to a person
by an agent rather than mailed, and never meeting a scanner. If the answer is
"redeem on POST rather than GET", it belongs on the mailed link; applying it to
both is harmless, but applying it only to the relay link would fix nothing.

## Work

The link must survive being fetched by a machine. Standard approaches, roughly
in order of how well they fit:

- **Do not redeem on `GET`.** Land on a page that says "Open your journal" and
  redeem on the `POST` behind a button click. Scanners follow links; they do
  not submit forms. This is the conventional answer to exactly this problem and
  it keeps the one-tap feel to within one tap.
- **Do not consume the standing link at all.** It is meant to be permanent, so
  arguably redemption should mint a session and leave the row live, with
  revocation the owner's explicit act. That makes a prefetch harmless rather
  than fatal. Weigh against: anybody who ever sees the mail keeps access, and
  forwarding it hands over a session — which the letter already warns about.
- Shorten the minted session, if the redeemer looks automated. Weak on its own,
  but a year is a long time for a credential created by something that never
  asked for one.

Whatever is chosen, `/<user>/me?signin=expired` needs to explain what happened
and offer a fresh code, because the person seeing it did nothing wrong and
today's copy implies they were slow.

Not doing: blocking known scanner user-agents. It is an arms race, it fails
open, and it would not have caught this one.

## Acceptance

- A `GET` of a welcome sign-in link by something that does not act like a
  browser does not spend it — asserted by a test that fetches the URL and then
  redeems it successfully afterwards.
- A person following their own welcome link after a scanner has seen the mail
  reaches a signed-in journal, not `signin=expired`.
- No session is created by a fetch that did not complete the deliberate step.
- The `signin=expired` page explains and offers a new code.

## Also, for whoever tests this

Any ticket needing an unspent welcome link cannot reuse the three from
2026-09-03 — they are gone. It needs a fresh journal creation, and the link
must be read from the `.eml` on disk and redeemed **quickly**, or the same
sweep will take it. B69 is the ticket this blocks.
