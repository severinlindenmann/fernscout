# Fulfilment relay for self-hosted instances — B492

**Goal:** let an instance with no printer account and no payment provider hand
a finished photobook or postcard job to an instance that has both, so the
self-hoster's own "generate" button ends somewhere other than a local PDF.
This file is the design — the money shape, the three open questions, and the
protocol that falls out of them — plus the tickets that build it. It is not
itself an implementation; B492 asked for a spec, and the honest reading of
"decide the money shape first" is that nothing downstream should be built
until these three answers are pinned down.

**Status:** design decided; nothing beyond the capability-honesty slice
below is built. `npm run verify` is green on that slice; the rest is filed as
tickets (see "Captures" at the end).

## Recap of the shape

Both `lib/postcard/` and `lib/photobook/` already produce a print-ready PDF
locally with no account of any kind — `dry-run` writes the files and calls
nobody. What is missing on a self-hosted instance is everything downstream of
the PDF: an account with a printer, a payment method, and the credits ledger
(`lib/credits.ts`) that gates `sendOrder`. All three of those live on
whichever instance the operator runs, by design (`AGENTS.md`: secrets are
environment-only, and nothing user-owned lives outside `content/`). A
self-hoster cannot open a printer account for one book a year, and should not
have to.

The fix on offer is a **relay**: the self-hosted instance ("origin") keeps
rendering locally, then hands the finished artefact to a **fulfilment
instance** — an ordinary Fernscout instance that has chosen to advertise
printer credentials and a payment method for other instances to use. Nothing
about rendering changes. Nothing about `sendOrder`'s three-step discipline
(claim, spend, print) changes on the fulfilment instance's own side — a
relayed job becomes an ordinary local order there, paid for by whoever opens
the link instead of drawn from a credits balance.

## The three open questions

### 1. Payment link per order, or an instance-level credits balance?

**Decision: a payment link per order.**

An instance-level balance is `lib/credits.ts` reached over HTTP, and that
module's whole design — the atomic `UPDATE ... WHERE balance >= n`, the
ledger, `grant()`'s single non-HTTP caller — exists because a balance that a
request can increase is a balance a request can defraud. Standing that up for
a second instance means: provisioning an instance credential, a top-up flow,
refunds when a fulfilment instance is unreachable mid-print, and reconciling
two operators' books against one another. That is real infrastructure for a
self-hoster who orders one book a year.

A payment link needs none of it. It is the same shape `POST
/api/v1/<user>/postcards` already uses today — an agent (or, here, the origin
instance) proposes something that costs nothing and prints nothing, a person
opens a page, and pressing one button is the only thing that spends money.
`lib/payments.ts`'s mock ledger is the fulfilment instance's own existing
pattern for exactly this: a `pending → requested → paid` row addressed by an
unguessable id, with `claimApproval`'s rows-affected guard against a link
followed twice. A relayed job becomes one more row of the same shape, priced
from the fulfilment instance's own table, never from anything the origin
instance sent.

The cost of choosing this over a balance: every order pays retail (no bulk
discount for a self-hoster who orders often), and every order needs someone
to open a browser and pay, once, per book. Both are acceptable for the actual
use case — a self-hoster mails a handful of postcards and a photobook a year,
not fifty. If a self-hosted instance turns out to want a standing balance
because it is ordering constantly, that is a second, later ticket to weigh —
it is not a bar to clear before shipping the first version, and it does not
change anything about the protocol below (a balance would simply skip the
pay-button step and spend from the balance on arrival, using the same job
shape).

### 2. Who is the customer of record with the printer — us, or the self-hoster?

**Decision: the fulfilment instance's operator.**

This falls straight out of the reason the feature exists: a self-hoster has
no printer account and the entire point is that they never need one. If the
self-hoster were the customer of record, they would need their own account
with the print provider, which is the exact thing this ticket is meant to
remove. The fulfilment instance holds the provider credentials
(`PROVIDER_ENV` in `lib/capabilities.ts`), places every relayed order under
its own account, and is billed by the printer for it. What the fulfilment
instance collects from the person who presses Pay is retail price for one
printed object, the same as an order placed by one of its own journals — it
is a print broker's ordinary shape, not a wholesale relationship with the
origin instance. The origin instance never sees a printer credential, never
touches a card, and never appears to the printer at all.

The consequence worth naming rather than hiding: the fulfilment operator
carries the fraud and chargeback exposure for jobs it did not compose and
cannot inspect the history of, from an origin instance it does not run. That
belongs in the pricing and in the abuse controls (see the captures below,
particularly the storage TTL and the rate limiting) — it is a real cost of
offering this at all, and "not doing: reselling anything but our own print
providers, no marketplace" already says the intended shape is one operator's
own account fulfilling for a small number of trusted-enough origins, not an
open exchange.

### 3. Does the PDF upload to us, or do we fetch it from their instance?

**Decision: the origin instance uploads it to us.**

`lib/photobook/providers.ts` already settled the equivalent question one hop
further down the chain, for a different reason worth borrowing: "three of
these four [printers] do not accept an upload at all: they fetch the file
from a URL you give them, which means a self-hosted book needs a reachable,
unguessable link before a single order can be placed." Requiring the *origin*
instance to be fetchable would import that same requirement one hop earlier
and for a worse reason — a self-hosted instance is frequently **not**
publicly reachable on purpose (home network, VPN-only, a NAS with no port
forwarded), and the people who most want this relay are disproportionately
the people whose whole reason for self-hosting was to keep their own box off
the public internet. Making that a prerequisite would mean the feature works
for nobody it is for.

Upload is also an outbound POST, which every self-hosted box that can reach
the internet at all can already do with no inbound configuration whatsoever.
And it bounds the exposure: the fulfilment instance holds the artefact only
for as long as the order can still be paid and printed, then deletes it (see
the TTL capture below) — an indefinite public URL on the origin's own box has
no equivalent expiry unless the origin instance builds one itself, which is
exactly the kind of infrastructure this feature is supposed to spare it.

Where a print provider itself insists on fetch-from-url (most of the four in
`lib/photobook/providers.ts` do), that is the fulfilment instance's own
problem to solve with its own storage, the same way it already has to for its
own journals' orders — it is not a reason to make the origin instance
fetchable.

## The protocol this settles on

None of this is built yet; it is what the three decisions above commit the
implementation to, so the tickets below have a target rather than a blank
page.

1. **Capability, both sides, off by default.** A new `fulfilment` feature
   (`lib/capabilities.ts`) with two independent halves, because an instance
   can be either, neither, or both:
   - `relay`: this instance may hand a job to another instance. Needs one
     config value — which fulfilment instance to use (a URL) — and no
     secret, matching "no accounts, no API keys on the self-hoster's box".
   - `accept`: this instance will take jobs from other instances. Needs
     everything `postcards`/`photobook` already need (a real, non-`dry-run`
     provider, per this file's `dryRunNote()` slice) plus a real payment
     method — accepting jobs into a `dry-run` provider would relay nothing
     that was not already possible locally.
2. **The job, not the trip.** The origin instance renders exactly as it does
   today and uploads the finished artefact (the interior + cover PDFs for a
   photobook, or the four print files for a postcard) plus the metadata the
   fulfilment instance needs to price and ship it: product type, page count
   or card count, trim size, and — for a postcard — the recipient's address,
   resolved from the origin's own `contactId` exactly as `sendOrder` does
   today. Nothing about a trip, a day or a photograph's caption crosses the
   wire; the PDF already has whatever the reader will see baked into it.
3. **The fulfilment instance prices it, not the origin.** The same discipline
   `orderCost()` already applies locally — the price is read from the
   fulfilment instance's own table, never trusted from the request — because
   an origin instance is, from the fulfilment instance's point of view, an
   unauthenticated caller.
4. **The job costs nothing to create.** Same rule as
   `lib/postcard/orders.ts`'s `createOrder`: uploading a job is free and
   prints nothing, so an agent on the origin side can propose one freely. The
   fulfilment instance answers with an unguessable URL, on its own domain,
   the same shape `POST /api/v1/<user>/postcards` already answers with today.
5. **A person pays on the fulfilment instance.** That page shows the preview,
   the price, and one button — `lib/payments.ts`'s existing
   `pending → requested → paid` shape, or a real gateway if one is wired by
   then; either way, the fulfilment instance's own money code, unchanged in
   shape. This is also where "the agent never spends money" holds without a
   new argument: the button is on the fulfilment instance's page, which an
   agent cannot reach any more than it can reach `/<user>/postcards/<id>`
   today.
6. **Status flows back, honestly.** The origin instance's own page must not
   claim a job is printed until the fulfilment instance says so. `sendOrder`'s
   own comment about `202` and deletion is the model: a job handed off is "a
   preview is waiting" or "paid, printing" — never "sent" until the
   fulfilment instance confirms it, via a webhook or a poll the origin
   instance owns.
7. **Storage is bounded.** An uploaded artefact that nobody pays for is a
   real cost to the fulfilment instance (bandwidth and disk, from a caller it
   does not otherwise trust) and needs a TTL and a sweep, the same shape
   `ORDER_TTL_MS` already gives a local postcard order.

## What this deliberately does not decide yet

- **How an origin instance is admitted at all.** The three questions above
  are about money and about the artefact; they say nothing about whether
  *any* instance may relay to *any* other, or whether the fulfilment operator
  needs some lightweight registration (an email-verified relay key, no money
  attached, purely to rate-limit and to have somebody to write to when a
  relay is abused) before its jobs are accepted. This is an abuse-control
  question, not a payment question, and answering it is one of the captures
  below rather than a fourth open question this file resolves — the payment
  shape (a link, not a balance) holds either way.
- **A real print provider on the fulfilment side.** B435 (postcards) and its
  photobook counterpart (B476 already tracks the photobook order flow; a
  wired provider is separately unbuilt) are what actually turns a fulfilment
  instance's own local orders into printed objects. The relay is only ever as
  real as whichever provider the fulfilment instance has wired — an instance
  offering `accept` on a `dry-run` provider is offering nothing a self-hoster
  could not already do locally, and `dryRunNote()` (this file's shipped
  slice) is what stops that from reading as a working printer.
- **A real payment gateway.** `lib/payments.ts` is a mock ledger today
  (`createPayment`/`submitRequest`/`claimApproval`, with the actual grant
  behind an operator's mail approval). Whether a relayed job's payment page
  uses the same mock, or needs a real gateway first, is downstream of
  whichever ticket wires payments for credits generally — not something this
  spec needs to settle to describe the relay's shape.

## What is not demonstrable in a checkout

The ticket's Acceptance line — generate on a credential-less instance, get a
link, pay on the fulfilment instance, it prints and posts — cannot be shown
end-to-end here, for reasons that are true regardless of how carefully the
relay is built:

- **There is no second instance.** The Acceptance line names two roles
  ("an instance with no printer credentials" and "the fulfilment instance").
  A worktree is one checkout; demonstrating the handoff for real needs two
  running processes with two `CONTENT_DIR`s and, eventually, two domains —
  nothing this ticket builds changes that.
- **No print provider is wired on either side.** `lib/postcard/providers.ts`
  and `lib/photobook/providers.ts` are both "prepared but not connected"
  (see B435, and the photobook equivalent). "It prints and posts" cannot be
  true anywhere in this codebase yet, on one instance or two — that is a
  precondition of B492, not something it can build around.
- **Payment is a mock everywhere it exists.** `lib/payments.ts`'s own
  comment: pressing Pay "never adds credits" — a real charge needs a real
  gateway, unbuilt. "Pay on the fulfilment instance" can be demonstrated as
  far as the mock goes and no further.

What *is* demonstrable, and is the slice this ticket actually ships: a
capability that was silently "on" while unable to fulfil anything now says so
— `npm run verify` and `test/capabilities.test.ts` cover it.

## Captures

Filed against this spec:

- **B588** (superseded by this ticket) — a print capability with `dry-run`
  reported the same `enabled: true` as one that could actually post. Built
  directly as this ticket's small, safe slice — see `lib/capabilities.ts`'s
  `dryRunNote()`.
- **B589** — `fulfilment` capability skeleton (`relay`/`accept` halves, off
  by default, `/api/health` reporting both) — no protocol yet, just the
  switch and its honesty.
- **B590** — the job intake route on the accepting side: upload, price from
  the fulfilment instance's own table, an unguessable URL, a TTL and a sweep
  for unpaid jobs. Depends on B589.
- **B591** — the relay client on the origin side: render as today, upload the
  artefact plus job metadata, surface the returned URL to the owner exactly
  as `POST /api/v1/<user>/postcards` does today — never to the agent as a
  completed order. Depends on B589 and, to be tested end-to-end, B590.
- **B592** — status callback from the fulfilment instance back to the origin,
  so the origin's own page never claims more than the fulfilment instance has
  confirmed. Depends on B590 and B591.
- **B593** — admission and rate control for `accept`'s intake route: whatever
  mechanism is chosen (see "What this deliberately does not decide yet"
  above), so an unauthenticated upload endpoint cannot spend the fulfilment
  operator's storage or money. Depends on B590.
