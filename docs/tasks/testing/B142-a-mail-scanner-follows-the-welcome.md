---
id: B142
title: A mail scanner follows the welcome link, spending the owner's one-tap sign-in and minting a year-long session
type: SECURITY
priority: high
complexity: medium
area: auth, mail, onboarding
found: "2026-09-03"
started: "2026-09-03T19:48:54Z"
merged: "2026-09-03T20:02:18Z"
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

## What was built

The first option: **do not redeem on `GET`.** `app/[user]/s/[token]/route.ts`
is gone and is now a `page.tsx` that renders "Open your journal" and a button;
the button posts to a new `app/api/auth/link/route.ts`, which holds the
redemption and the `landing()` destination rule unchanged. Scanners follow
links; they do not submit forms — the same mechanism the sibling at
`/{user}/u/{token}` has always used for unsubscribes.

It applies to **both** link kinds, which the scoping note says is harmless and
is: the relay link keeps its 15-minute expiry and its single use, and gains one
press. Nothing about `issueRelayLink` or `issueStandingLink` changed, so the
two tokens remain the separate rows B29's verification established.

Not done, deliberately: user-agent sniffing (ruled out in this task), and
shortening the minted session. With the fetch no longer minting anything, a
year-long session is only ever created by a person pressing a button, which is
what that bullet was worried about.

### The route's own comment was the bug's alibi

Worth recording, because it is how this survived review. The deleted route
argued for redeeming on GET in its own doc comment:

> Here, the worst a scanner can do is mint a *read* session it will never use,
> on a journal whose pages are public anyway, and the reader's code stays live
> (see `verifyLink`), so they are never locked out by a robot that got to their
> inbox first.

Both halves were wrong. A guest session reads `guest` trips, which are not
public. And the reader **was** locked out — the code stays live, but the mail's
button carries the *link*, and that is what the scanner spent.

That comment was also cited as precedent in
`app/api/v1/[user]/deletions/[token]/route.ts`, which reasoned about where the
GET/POST line sits by pointing at it. Both citations are corrected here;
leaving them would have left a security decision resting on a finding that had
been reversed.

### The expired page said nothing at all

`?signin=expired` has been redirected to since the link existed, and **nothing
on `/<user>/me` ever read the parameter** — so the acceptance bullet below was
further from true than the task assumed. It now renders one of two sentences,
above the sign-in control it tells them to use, and the copy says plainly that
mail providers open links before their reader does and that this is not
something they did wrong. Three locales, since the audience for it is exactly
the audience `me.askOwner` is written for.

## Acceptance

- A `GET` of a welcome sign-in link by something that does not act like a
  browser does not spend it — asserted by a test that fetches the URL and then
  redeems it successfully afterwards.
  **Met** — `test/signin-destination.test.ts`, "the fetch leaves the link live,
  and the person still gets in". Note the stronger property actually built: no
  `GET` spends it, browser or not, so there is no sniffing to get wrong.
- A person following their own welcome link after a scanner has seen the mail
  reaches a signed-in journal, not `signin=expired`.
  **Met** — the second half of that same test, plus "a sweep of the whole inbox
  spends nothing", which models the three-links-in-twelve-seconds pattern from
  the log.
- No session is created by a fetch that did not complete the deliberate step.
  **Met** — "no session is created by a fetch that did not press anything"
  counts rows in `sessions` before, after the fetch, and after the press.
  Against the old behaviour it fails with `expected 1 to be +0`.
- The `signin=expired` page explains and offers a new code.
  **Met** — `test/access-panel-capability.test.ts`, "a spent link is explained,
  and a throttle is a different sentence". A companion test asserts an
  unrecognised `?signin=` value renders nothing, so the parameter selects a key
  and never becomes text.
- Still single use once a person has pressed it — asserted, so the fix cannot
  be mistaken for making the link reusable.

Verified with all four: `npx tsc --noEmit`, `npx eslint .` (0 errors),
`npx vitest run` (1856 passed, 2 skipped), `npm run build`.

**For whoever tests this:** the note above about the three spent links from
2026-09-03 still holds — they are gone and cannot be reused. A fresh journal
creation is needed, but the link no longer has to be redeemed *quickly*, which
was the awkward part of that instruction.

## Also, for whoever tests this

Any ticket needing an unspent welcome link cannot reuse the three from
2026-09-03 — they are gone. It needs a fresh journal creation, and the link
must be read from the `.eml` on disk and redeemed **quickly**, or the same
sweep will take it. B69 is the ticket this blocks.
