---
id: B1065
title: There is no way to prove that somebody holds the telephone number they typed
type: FEATURE
priority: high
complexity: medium
area: auth, otp, sms, whatsapp
found: "2026-09-09T07:11:55Z"
started: "2026-09-09T17:22:12Z"
merged: "2026-09-09T18:34:33Z"
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

## The mechanism is back in question — 2026-09-09

Researched after seven.io refused. Two things changed since the owner chose
SMS over the free WhatsApp-inbound proof, and together they are enough to put
the choice back in front of him.

### 1 · The gate is structural, not a seven.io quirk

Direct carrier aggregators sell to *traders*, and a solo operator without a
Handelsregister entry is the awkward case. **A CPaaS reseller is the way past
it**: Twilio, Vonage and Sinch have already done the carrier KYC in every EU
market, and a customer rents that relationship rather than establishing one.
That is plausibly the actual fix for SMS, and it is self-serve.

**Twilio Verify is the specific candidate, and it removes two problems at
once.** Roughly **$0.05 per successful verification plus the channel cost**,
self-serve with a free trial. Crucially it **manages the sender itself** — so
there is no alphanumeric sender id to register, which means:

- the **Austrian registration deadline stops applying**; and
- Twilio's own rule that alphanumeric senders are blocked on trial accounts
  stops mattering.

*Both of those need confirming against Twilio Verify's own documentation
rather than inferred from the sender-id rules for raw Programmable SMS — but
if they hold, most of the friction in this ticket disappears.*

It also has built-in **SMS → voice fallback**, which covers the A2P-filtering
failure mode that B1067 recorded as a reason not to build voice separately.

### 2 · The exclusion figure is now known

WhatsApp penetration among messaging-app users: **Switzerland ~95.9%, Germany
~95.5%, Austria ~94.4%**. Hungary unconfirmed, regionally high. So a
WhatsApp-only proof excludes roughly **4–6%**, *"concentrated
disproportionately in older cohorts."*

**That last clause is the whole argument for this product, and no external
research would have known it.** AGENTS.md opens its account of the honesty
guards with a 71-year-old who was told *"Der Text ist gespeichert"* when
nothing had been written. The machinery in `lib/helper/model.ts` exists
because of her. A signup that quietly excludes the demographic she belongs to
is not a neutral 5% — it is 5% taken disproportionately from the people this
product was built to reach.

So *"everyone has WhatsApp"* is exactly the assumption this codebase is least
entitled to make.

### What this means for the ticket

Three shapes, and the owner picks:

1. **SMS via a CPaaS reseller** (Twilio Verify). Keeps the Q3 decision intact
   and fixes the reason it failed. Costs about €25–50 a year at this volume,
   and adds no exclusion.
2. **WhatsApp inbound primary, SMS fallback.** Cheapest for the 95%, and the
   5% still get in. Two paths to build and to explain, and the fallback is
   the one that gets least testing precisely because it is rare — which is
   how it will be broken when somebody's mother needs it.
3. **WhatsApp inbound only.** Free, no provider at all, and it accepts the
   exclusion above. Genuinely the laziest option, and the one I would not
   take for this product.

`toE164` and the `login_codes` machinery are unaffected by all three. What
changes is which transport module gets written, and whether one gets written
at all.

## Decided: Twilio Verify — 2026-09-09

The owner chose **SMS via Twilio Verify**, and chose not to chase seven.io:
*"a provider whose terms make you argue for eligibility is a provider that can
change its mind later."* seven.io is closed.

### Two claims this rests on, and both are UNVERIFIED

Said plainly, because the last recommendation failed on exactly this shape of
gap:

1. **That Verify manages the sender itself**, so there is no alphanumeric
   sender id to register — which is what would make the Austrian deadline and
   Twilio's block on alphanumeric senders for trial accounts both irrelevant.
2. **The per-verification price to CH, DE, AT and HU.** The figure in
   circulation is roughly $0.05 plus channel cost, from a US-centric page.

Twilio's documentation is a JavaScript-rendered app and would not yield either
answer to two attempts; the session's web-search budget is spent. **Confirm
both before writing a line of code**, and prefer Twilio's own console or
support over a summary. The six questions in B1067 apply unchanged.

### The design change, which does not depend on those answers

**Verify is not a transport. It is a verification service, and it owns the
whole code lifecycle** — generating the code, storing it, counting attempts,
expiring it, rate limiting. That is a different shape from what this ticket
assumed, and it cuts both ways.

**What it removes:** the `phone` kind on `login_codes`, the hash-only storage,
the attempt counter, the TTL, the supersession-on-reissue. All of it becomes
Twilio's. That is a real simplification — a table this codebase already
maintains does not grow a second meaning.

**What it costs:** this repository's OTP discipline is unusually careful and
deliberately so — `lib/auth/index.ts` stores only a hash, burns after five
attempts, returns one shape for every failure mode so nothing can be probed,
and supersedes the previous code on every reissue. **Handing that to Twilio
means adopting Twilio's discipline instead**, whatever it is, and losing the
property that every credential in this system is verified by one function
somebody here has read.

So the fork is:

- **A · Verify as a black box.** Call `verifications.create`, then
  `verificationChecks.create`. Least code, no sender id, voice fallback
  included. The code never touches our database and its rules are Twilio's.
- **B · Twilio's raw Messaging API as a transport** under the existing
  `login_codes` machinery. Keeps the discipline and the pattern this codebase
  already has twice — and reintroduces the alphanumeric sender id, its
  per-country registration, and the Austrian deadline. Which is most of what
  made SMS hard.

**A is the reason Verify was chosen and it is almost certainly right**, but it
should be chosen knowingly rather than discovered. Whoever takes this writes
one paragraph in the code saying that phone codes are Twilio's to manage and
email codes are ours, and why the two differ — otherwise the next reader finds
an inconsistency and "fixes" it.

**Local development** also changes shape: not our own dry-run backend writing
a payload to disk, but Twilio's test credentials and magic numbers. Check that
those exercise Verify and not only Programmable SMS — AGENTS.md's rule that no
feature may need a paid account to develop against still has to hold, and it
is now somebody else's mechanism that has to satisfy it.

### The test-journal path is unaffected

A test signup still gets a real code written to disk rather than sent (see
above). That path must not go through Twilio at all — which is convenient,
because it means the free local path stays ours regardless of what Verify
does.

## Dry-run first — and the seam that decides it works — 2026-09-09

The owner: **build against a dry-run backend first, wire Twilio Verify
second.** That matches the phase order already written (step 2 needs no
provider account and can start before step 1 finishes), and it means the whole
signup flow can be finished and tested before anybody signs a thing.

**But the obvious seam breaks Verify, and the plan document leans the wrong
way.** It describes *"a dry-run backend that writes the payload it would have
sent"* — copied from `lib/mail` and `lib/whatsapp`, where the thing being
abstracted really is *a message being sent*. Verify is not that. **Verify
generates the code, stores it, counts the attempts and expires it.** A
transport interface assumes *we* make the code and hand it over, so a real
backend behind it can only be Twilio's raw Programmable SMS — which brings
back the alphanumeric sender id, its per-country registration and the Austrian
deadline. All the things Verify was chosen to avoid.

So the seam is **not "send this SMS". It is "prove this number".**

```
startVerification(phone, locale) -> { id }
checkVerification(id, code)      -> ok | wrong | expired | burned
```

Two calls, at the altitude of the capability rather than the mechanism, and
both backends fit:

- **`dry-run`** makes its own code, writes it where the mail already goes,
  and checks it against `login_codes` with a `phone` kind — this
  repository's own discipline: hash only, five attempts, thirty minutes,
  superseded on reissue.
- **`twilio`** delegates both calls to Verify and touches `login_codes` not at
  all.

This is the same instinct `lib/whatsapp/types.ts` already writes down at
length — its message type is *"always a template"* because that is what the
capability genuinely is at that boundary, not a simplification. Get the
altitude right and the second implementation drops in; get it wrong and the
second implementation cannot exist.

**One honest cost of the split**, worth a comment where it is decided: in
development the attempt counter and the TTL are ours, and in production they
are Twilio's. So a bug in *our* attempt handling cannot show up in production,
and a difference in *Twilio's* cannot show up in development. That is the same
trade `file` versus `smtp` mail already makes and it is acceptable — but the
numbers should be configured to match, so the two behave alike as far as
anybody can tell from outside.

The test-journal path (a real code written to disk) is the dry-run backend
under another name, so it comes free and stays ours in production too.

## Built — 2026-09-09

Validity already established by the plan-a-run gate for group-phone; see
`.claude/runs/2026-09-09-phone-and-gates/brief.json`. Built directly on B1064.

**The seam is exactly what the "Dry-run first" section specified.**
`lib/phoneVerify/types.ts` — `startVerification(phone, locale) -> {id}`,
`checkVerification(id, code) -> {status:"ok", phone} | {status: "wrong"|"expired"|"burned"}`.
`lib/phoneVerify/dryRun.ts` is this repository's own OTP discipline
(hash-only, 30-minute TTL, 5-attempt burn, supersession on reissue) using
`kind: "phone"` on `login_codes` — a plain string, deliberately outside the
`SessionKind` union, since a phone proof opens no session.
`lib/phoneVerify/twilio.ts` is the real backend (unverified against a live
account — no Twilio credentials were available to this run; the two
`UNVERIFIED` claims in this ticket's own "Decided: Twilio Verify" section
still stand and should be confirmed before flipping `phoneBackend` to
`"twilio"` anywhere real). Backend picked by `features.signup.phoneBackend`,
wired into `lib/capabilities.ts` the same way `whatsapp.backend` is.

**Where the proof lives, since the ticket didn't say:** on the `signup`
session itself. `sessions` gained two nullable columns (`phone`,
`phone_proven_at`, migration `028-signup-phone`), written once by
`markPhoneProven()` on a successful check. `POST /api/v1/journals` reads
them off the resolved session — never off a field the create request could
simply assert — which is also what makes a stolen/guessed `id` at the verify
step harmless: it can at most attach some number to *this* signup token, and
the token is already proof of the address.

**Routes**: `POST /api/auth/signup/phone/request` (rate-limited 3/tel/day,
5/address/day, 50/instance/day, all via `lib/rateLimit.ts`'s generic keying —
not IP) and `POST /api/auth/signup/phone/verify`. `POST /api/v1/journals`
now refuses `phone_required` (400) unless the caller is `FERNSCOUT_ADMIN_EMAIL`
or the username starts with `test-` (B1064's two exemptions) — this is where
those exemptions are actually enforced, since `createJournal()` itself stays
permissive for its ~10 direct test callers.

**Simplification against the ticket's own "test journal" bullet**: no
test-bypass flag was built on `/phone/request`. B1064's later "Decided
further" section makes test journals **exempt from proving a number at
all**, which already gives the "test journal, no real SMS cost" property the
original bullet was reaching for — building a second bypass mechanism inside
the verification service itself would have been redundant machinery. If a
future ticket wants to exercise the *phone-proving flow itself* against a
`test-` journal end to end, that is new scope, not a gap in this one.

**Contract**: both new routes are in `lib/api/openapi.ts` with refusals;
`phone_required`/`verification_failed` are in `lib/api/errorCodes.ts`.
`test/openapi-contract.test.ts` and `test/api-route-schemas.test.ts` pass.

Nine existing test files that drive `POST /api/v1/journals` through the real
route (not through `createJournal()` directly) needed a `signupToken()`
helper update to complete the phone step first — otherwise every one of
them now gets `phone_required`. Each was given a unique fake E.164 number
per call (a counter) so B1064's tel-uniqueness lock does not collide
between them.

Evidence: `test/signup-phone.test.ts` (6 tests) — start/check round trip
with the code read back off disk exactly as an agent driving a real signup
would have to, `phone_required` on a bare create, the proven number landing
in the new journal's `owner.tel`, the `test-` exemption, one number refused
for a second journal (`tel_taken`), and a national number with no country
code refused. Full suite: `npx vitest run` — 472 files, 6343 passed, 4
skipped, 0 failed.

Pure backend; no page to screenshot (the signup wizard's browser flow that
would add a phone step is not part of this ticket).
