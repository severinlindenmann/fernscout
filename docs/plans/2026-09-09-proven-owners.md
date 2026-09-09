# Phase 1 — a journal's owner is a proven address and a proven number

Written before the work, 2026-09-09. Kept as the record of intent; not
corrected afterwards (see `docs/README.md` on `docs/plans/`).

Covers **B1065**, **B1064**, **B1066** and **B1073**, and depends on **B1067**
having chosen an SMS provider. It is phase 1 of the plan recorded in those
tickets; the WhatsApp channel is phase 2 onward and is deliberately not here.

## What this has to be true of, afterwards

**One journal per proven address. One journal per proven number.** Two
independent constraints, not a constraint on the pair — the pair reading
permits exactly what the second clause is for (same number, new address,
second journal), and two rules can be explained to somebody who hits one.

**A number is proven once, at signup, and never again.** Login stays the email
passcode it is today. The number is not a second factor and must not become
one: adding it to the login path would mean every sign-in depends on a paid
message and on a phone somebody may not be holding.

That decision is what makes the whole thing affordable — **one paid message
per account, for its lifetime** — and it is also the thing most likely to be
undone by accident later. Anybody reaching for "let's verify the number again
here" is changing the cost model, not adding a safeguard.

## Why the number is asked for at all

The owner's answer, and it decides the shape: **reachability first**, with
anti-abuse as a side effect. The number exists so a messenger can find the
journal (phase 2); that it also makes a second journal expensive is a
consequence, not the purpose.

That matters twice over.

- It is why the number is **stored in the clear** rather than hashed. A hash
  would satisfy uniqueness and could not be compared against the E.164 an
  inbound webhook carries.
- It is why **plus-addressing is not folded**. `me+1@gmail.com` and
  `me+2@gmail.com` remain two addresses, because the number is doing the
  anti-abuse work and folding is occasionally wrong — some people use a plus
  address as their real one.

## Where ownership lives, and what may not change about it

Ownership is `owner.email` in `content/<username>/config.json`, and it stays
there. `lib/journals.ts:126 journalsOwnedBy()` reads every `config.json` off
disk to enforce `MAX_JOURNALS_PER_EMAIL = 1`.

**The disk stays the truth.** A journal folder that is exported, carried to
another instance and restored must still be that person's journal, and nothing
in this plan may make a database row the thing that decides who owns what.

But a directory scan is not a constraint. Two concurrent creates for one
address, under different usernames, both pass the check before either
directory exists; and the scan costs more as the instance grows, on every
signup. With a second field to check and a second async proof step in front of
it, the window widens.

**So: a database table with real unique indexes, as a lock over a truth that
still lives on disk.** The distinction is the whole design, and it has one
non-negotiable consequence:

> The table must be **discardable and rebuildable** from `content/` alone. A
> `reconcile` command that drops it and rebuilds it by scanning is part of
> this work, not a follow-up — it is what proves the disk is still the truth
> rather than merely being claimed to be.

## Where the number lives

`owner.tel` in the same file, with a proof stamp beside it.

`owner.tel` already exists and already means something: *"the owner's own
telephone number, for their own free WhatsApp copy of a published day"* (B614,
`lib/config.ts:102-125`). It is parsed through `toE164` with **no default
country code**, so a bare national number is refused outright — that stays,
and is the right behaviour.

One field rather than two, because one number is what a person has and asking
for two is a question nobody understands. The cost is that **a destination has
silently become an identity**, and the code has to say so where it is decided
rather than leaving the next reader to discover it. A number present without a
proof stamp is a pre-existing destination and is *not* proof of anything;
`parseOwner` must not treat absence of the stamp as absence of the number.

## The proof itself

A third transport of a shape this repository already has twice.

`login_codes` (`lib/db/schema.ts:79-123`) gains a `phone` kind and is used
unchanged otherwise: **hash only, never the code**; `revokeCodes` first, so
asking again invalidates the last one; `CODE_TTL_MS` of thirty minutes;
`MAX_CODE_ATTEMPTS` of five, then the row burns; and every failure mode
returning one shape to the caller so nothing can be distinguished by probing.
Do not invent a second store. The column that holds an address holds a number
for these rows, and that is a smaller lie than a parallel table.

The transport module is `lib/mail/index.ts`'s shape, not a new one: an
interface, a **dry-run backend that writes the payload it would have sent**,
and a real one, with no caller knowing which is in use. A capability entry in
`lib/capabilities.ts` naming its environment, off by default, and
`/api/health` explaining what is missing when it is off. AGENTS.md's rule that
no feature may need a paid account to develop or test is what forces this, and
it is not negotiable for a feature whose whole job is to spend money.

### The order, and why it is this order

**Email first. Then the number. Then the journal.**

Today's flow is unchanged up to the signup token: `POST /api/auth/signup/request`,
then `.../verify`, then a twenty-minute bearer scoped `create:journal`. The
phone step is inserted between that token and `POST /api/v1/journals`.

The reason it is this order and not the reverse: **a bot must pass the free
gate before it can cost the operator a message.** An address has to be proven —
which costs an email and nothing else — before a single SMS is sent. Reversing
it puts the paid step first and hands a stranger a way to spend money without
proving anything at all.

Nothing is written until both are proven, so an abandoned signup leaves
nothing behind.

### The ceilings, which are the actual security control

`lib/rateLimit.ts` is per-IP and in-process. That is the wrong key for this
and has to be joined, not replaced:

| Key | Limit |
| --- | --- |
| Per number | **3 per day** |
| Per address | **5 per day** |
| Per instance | **50 per day** |

Fifty a day is roughly CHF 3 at Swiss retail — a number the operator would not
mind paying twice, which is the test that was applied. **Refuse, never queue.**
A queued message is a message that will eventually be sent and paid for.

### When it does not arrive

One resend, then an offer to correct the number. Two attempts against the
per-number cap of three, and then the person may fix a typo rather than being
trapped on a number they mistyped — by far the commonest cause of a code that
never comes.

No voice-call fallback. It is a second provider integration for a failure mode
nobody has measured yet, and A2P filtering is a real thing that can be dealt
with when it is observed rather than anticipated.

### The sender ID, and a promise not to make

The provider will send from an **alphanumeric sender ID** (`Fernscout`), which
needs no number of our own. **It is one-way. Everywhere, for every provider.**
There is no number behind it for a reply to route to; a reply fails, bounces,
or is silently dropped with the sender never seeing an error. In Hungary,
carriers commonly overwrite the ID with a long code, so the code may arrive
from a number the person does not recognise.

So **the message must not imply a reply channel**: the code, what it is for,
and `agent@fernscout.ch` for anything else. This is B386's mistake in a
different medium — a footer promising *"STOPP zum Abbestellen"* over a channel
where nothing read a reply — and it is cheap to avoid once, and permanent to
get wrong.

### Test journals

A test signup gets a real code **written to disk** rather than sent, where the
mail already goes, so an agent driving a test on the server can read it.

The obvious objection is the right one to answer, and the answer belongs in the
code: **a stranger who passes the same flag gains nothing, because they cannot
read the file.** The bypass is closed by construction rather than by a
permission check — which is the kind that does not rot when somebody later
refactors the gate.

Two things not to get wrong anyway: the code is a real, single-use,
attempt-limited code with the same TTL as any other, never a fixed string; and
the journal is still named `test-<something>` per AGENTS.md, so anybody who
finds it later can delete it without stopping to work out whose it is.

## Exemptions

Two, and no others.

- **The operator address.** `FERNSCOUT_ADMIN_EMAIL` is one address in the
  environment and owns no journal. Requiring a number would make `/admin`
  unreachable after a SIM change, which is the worst possible moment.
- **Test journals**, by the mechanism above — which is better than an
  exemption, because they still prove a number.

## The journals that already exist

There is no migration, because the population is one.

Most journals on the instance are tests and will be deleted; `severin` is the
owner's own and he will add a number to it. So the ticket that was written to
choose between grandfathering, asking and requiring (**B1066**) has no choice
left to make:

1. Delete the test journals, so the rule lands on a clean instance.
2. Add the owner's own proven number to `severin`.
3. Require a proven number from day one for everything created afterwards.

No grandfather clause, no asked-but-not-required state, no third code path
that exists for a population of zero.

**The one property that is not optional**: the files are on disk and an export
must keep working regardless of any of this. Assert it.

## Deleting a journal frees the address and the number

The **name** stays reserved by its tombstone (`content/.deleted/<username>.json`),
so old URLs keep answering 410 and nobody inherits somebody else's pages. The
**person** is not banned: somebody who deletes and regrets it can start again
the same afternoon.

That splits what used to be one fact into two that behave differently, which
is why **B1073** is in this phase and not a later one: `/admin` gains a
section listing held names and their dates, so an operator can see the half
that persists without opening a shell. Reading it is the whole of the problem
today; a button that permanently un-reserves URLs is a larger question and can
be a follow-up.

## What is deliberately not in this phase

- **Changing a number after signup.** Done by the operator, by hand, on
  request. Honest at a scale of one real journal, and it leaves a real dead
  end — somebody whose number changes loses a WhatsApp binding they cannot fix
  themselves. Capture the self-serve version as its own ticket the first time
  somebody asks, rather than pre-building it.
- **Anything about WhatsApp.** The binding reads what this phase writes and is
  B1058. Nothing here should be shaped by it beyond storing the number in a
  form `toE164` produces.
- **A recovery flow.** The number is not a way back in. Login is the email
  passcode, unchanged.

## Order of work

Each step verifiable on its own, in its own worktree, and each leaving the
tree shippable.

- [ ] **1 — B1067 first, and it is a person's decision, not a step.** The
      provider is chosen and an account exists, or nothing below can be
      finished. The current recommendation is `seven.io`, with GatewayAPI as
      runner-up and eCall worth a call first as the only candidate with an
      explicit DSG statement. **Ask about Austrian sender-ID registration
      before signing up** — unregistered IDs are dropped there from 1 October
      2026.

- [ ] **2 — The SMS transport, with nothing calling it.** Interface, dry-run
      backend, real backend, capability entry, `/api/health`. Verifiable by
      itself: a test drives the dry-run backend and reads the payload back off
      disk. This step needs no provider account, so it can start before step 1
      finishes.

- [ ] **3 — The `phone` kind on `login_codes`, and the two routes.** Mirroring
      `app/api/auth/signup/{request,verify}` exactly, including the always-202
      discipline. The three ceilings land here, keyed on number and address as
      well as IP. Verifiable: a code proves a number, is single-use, burns
      after five attempts, and a script cannot make the instance send a
      hundred messages.

- [ ] **4 — The registry table and its two unique indexes**, plus
      `reconcile`. Written and populated by `createJournal`, and rebuildable
      from `content/` alone. Verifiable: two creates for one address, and two
      for one number, run concurrently and exactly one of each succeeds — and
      the table can be dropped and rebuilt to the same state.

- [ ] **5 — `owner.tel` gains its proof stamp**, and `createJournal` requires
      a proven number with the two exemptions. Verifiable: a `config.json`
      with a `tel` and no stamp is a destination and not a proof.

- [ ] **6 — `/admin` lists held names.** B1073, small, and it is what makes
      step 4's freed-address behaviour visible to the person who has to
      support it.

- [ ] **7 — Clean the instance.** Delete the test journals, add the owner's
      number to `severin`, and only then switch the requirement on. This is
      an OPS step against the running server, not a diff.

## Verifying

`npm run verify` after each step — build, `tsc`, eslint, vitest, knip, in that
order and stopping at the first failure. The build goes first because it
writes `.next/types`, and this work adds routes.

Three things no test will catch, which somebody has to do by hand:

- **The dev server boots with the SMS capability both on and off**, and
  `/api/health` says something true in both states.
- **A real message arrives on a real telephone**, once, from the real
  provider, and reads correctly — including that it does not imply a reply
  channel. Do this before the ceilings are tightened, not after.
- **The signup page reads correctly at 390px** in all three locales. It is
  gaining a step, and a two-step flow that was tight on a phone is now a
  three-step one.

## Strings

Every new sentence is `site/locales/{en,de,hu}.json` and then
`npm run i18n:keys`. Real German and real Hungarian — nothing checks that a
translation means anything, so a plausible machine translation ships and is
read by somebody whose language it is. If you cannot write the language, say
so and leave the ticket short of done.

## The contract

`POST /api/auth/phone/request` and `.../verify` are new operations under
`/api/auth/**`, so they go in `lib/api/openapi.ts` with at least one documented
refusal beside the success — `test/openapi-contract.test.ts` fails otherwise.
`POST /api/v1/journals` gains a new refusal for a signup token whose number is
not proven, and that error code goes in `lib/api/errorCodes.ts`, which is
checked in both directions.

`/agent.md` describes signup for an agent that has never seen this instance.
It is now a three-step flow and the guide has to say so, or the first agent to
try will report a 4xx it cannot explain. Run `keep-the-contract`.
