---
id: B1058
title: An inbound message carries a telephone number and nothing that says whose journal it is
type: FEATURE
priority: high
complexity: high
area: whatsapp, identity, onboarding
found: "2026-09-09T07:11:42Z"
started: "2026-09-09T17:22:13Z"
session: df031729-b5f3-42f2-bcac-c6c88d608ee0
claimed: "2026-09-09T17:22:13Z"
---

# B1058 — An inbound message carries a telephone number and nothing that says whose journal it is

## Why

A webhook event carries `from`: a telephone number in E.164 digits. Nothing in
this codebase turns that into a journal.

The two places a number already appears are both the wrong shape for it.
`Owner.tel` (`lib/config.ts:102-125`) is *"the owner's own telephone number,
for their own free WhatsApp copy of a published day"* — a destination, never
proven, and absent from almost every journal. `contacts.postal_cipher` holds a
*reader's* number, encrypted, for postcards and announcements, and readers are
not owners.

So there are three questions and the code answers none of them:

1. **Whose journal is this?** A lookup from a proven number to a username. It
   does not exist because no number has ever been proven (B1065).
2. **What if nobody's?** A stranger messages the number. Today that is a
   signup opportunity and a spam surface at the same time, and every reply
   costs a model turn.
3. **Is a telephone number enough to write somebody's journal with?** It is
   the *only* credential WhatsApp offers. A lost phone or a swapped SIM is
   then a journal takeover, which is a weaker story than the six-digit code to
   a mailbox that every other door here uses.

Question 3 is the one that decides the shape of the other two, and it is a
person's to answer — see the question book. The honest framing: a number is
enough to *draft*, and the things that cannot be undone or that spend money
already end at a web page with a button (postcards, photobooks, credits,
deletion). That pattern was built for a different reason and happens to be
exactly the mitigation this needs.

## Work

- A binding from a proven E.164 number to one journal, normalised through
  `toE164` (`lib/whatsapp/phone.ts`) and nothing else. Where it lives depends
  on B1064; if that lands, this is a read of the same registry.
- First contact from an unknown number: decide between refusing with one
  sentence, or running the signup conversation in chat (ask for an address,
  mail a six-digit code, take it back in the chat — which proves both halves
  at once and costs nothing, since inbound opens a free window).
- A rate limit and a spend ceiling per number *before* the model is reached.
  `lib/rateLimit.ts` is per-IP and a webhook has one IP — Meta's. This needs a
  different key.
- An entry point: a `wa.me` link on the landing page and in the room, with a
  prefilled first message. Consider whether it should carry a one-time linking
  code so an owner already signed in binds their number in one tap.
- Nothing here weakens `isHelperOwner`; it satisfies B1055's resolver.

## Acceptance

A message from a bound number reaches that journal's helper and no other; a
message from an unknown number costs no model call and cannot be made to; and
a number bound to one journal cannot be bound to a second.

## Decided — 2026-09-09

Answered by the owner:

- **Binding is automatic.** The E.164 a webhook carries is compared against
  the number SMS proved at signup (B1065). No confirmation tap, no linking
  code — if it matches, it is their journal.
- **A stranger gets one sentence and a link**, and no model call. Signup in
  the chat was considered and rejected for the first release: every reply is a
  model call and the number is a public surface.
- **Owner only.** Not buddies, not guests. That is what the helper is today
  and it is what keeps the stored-conversation story defensible in the
  imprint — see B1063.
- **A day may be published from WhatsApp.** Publishing is reversible
  (`unpublish_day` exists), so the web-button rule does not extend to it. The
  four things that stay behind a web button are unchanged: buying credits,
  sending postcards, buying a photobook, deleting anything. Deleting a trip
  was briefly considered for an exception and the mailed link stays for every
  trip.

## Decided further — 2026-09-09

- **The first reply to a newly bound number carries three things**, and only
  on the first message of a binding — never on every conversation:
  1. **That this is an AI, and how to reach a human.** `agent@fernscout.ch`.
     Meta's policy update and the EU AI Act's transparency duty both point
     here; see B1077 for how firmly each is actually established.
  2. **Which journal it writes to.** *"I write into your journal at
     fernscout.ch/severin."* This is the cheapest possible guard against a
     wrong-number match, and it is checked by the one person who can tell.
  3. **That messages go to Meta and to the model.** The `words` consent scope
     has to be agreed here as it is in the web room, with a link to the
     imprint for the detail.
- **The photo-versus-document tip is deliberately not in this message.** It
  belongs on the first photograph, where it is relevant. A first message that
  explains file formats is a first message nobody reads.
- **The channel answers in the journal's own locale**, always — the same
  setting the web room and the day announcements use, and one the owner has
  already chosen. The model is instructed to answer in the person's language
  regardless, so a German sentence still gets a German reply; what is fixed is
  the interface: buttons, refusals, and the honesty guards' fallback
  sentences.

## Gap found — 2026-09-09

**The first reply to a newly bound number must be a fixed string, not a model
turn.** The ticket says what it has to carry (the AI disclosure, which journal,
the consent notice) and never said what produces it.

If it is generated, then *binding a number* becomes a free model call, and the
cheapest thing anybody can do to this instance — send one message from a number
that happens to match — is also a thing that costs the operator money. It also
makes three sentences that have legal weight (B1063, B1077) into three
sentences a model composes differently each time.

So: translated strings in `site/locales/*.json`, assembled in code. Same for
the stranger reply, which this ticket already specifies costs no model call —
the two are the same rule and should be stated once.

The general form, worth applying to anything added later: **a reply that says
something about the system rather than about the journal does not need a
model.** Confirmations, refusals, consent notices and the balance-empty
sentence are all in that class.

## Built — 2026-09-09

Validity already established by the plan-a-run gate for group-phone; see
`.claude/runs/2026-09-09-phone-and-gates/brief.json`. Buildable now because
B1064 (the registry) and B1057 (the webhook) are both built ahead of it in
this same branch.

- `lib/registry.ts` gained `journalForNumber(tel)` — a plain read of the
  existing lock file, with a comment stating explicitly that uniqueness is
  enforced at *write* time only (`reserve`/`reconcile`) and this read trusts
  it rather than re-verifying, per the owner's decision in the brief.
- `lib/whatsapp/dispatch.ts`'s `handleInboundMessage` (a logging placeholder
  from B1057) now does the real thing: `journalForNumber` decides automatic
  binding, no confirmation tap; a stranger gets `wa.strangerReply` and no
  model call; a newly bound number's first message gets `wa.firstReply` and
  is marked greeted (`lib/whatsapp/binding.ts` — a marker file under
  `content/<user>/whatsapp/.greeted/<tel>.json`, so the three disclosures go
  out once and never again for that number); an already-greeted number's
  message is logged and left for B1056/B1061's model turn, which does not
  exist yet.
- Both fixed strings are real translated strings in
  `site/locales/{en,de,hu}.json` (`wa.strangerReply`, `wa.firstReply`),
  assembled in code by `translateIn()` — never a model turn, per the "Gap
  found" section above, which this ticket's build treats as settled. The
  channel answers in the **journal's own locale** (`getUser().defaultLocale`)
  for the greeting; a stranger, who binds to no journal, gets English —
  there is no `Accept-Language` on a webhook delivery to pick from.
- `lib/whatsapp/reply.ts` is new: a free-form `text` send, gated by
  `whatsappInbound` (never `whatsapp`, which stays announcement-only) and
  used only from inside the window an inbound message has just opened —
  `types.ts`'s comment that outbound is "always a template" is updated to
  say why that claim is still true for `sendTemplate` and does not extend to
  a reply.

**Not built, and said plainly rather than silently dropped:**

- **The mockup's "Reply 'yes' to continue"** — an explicit consent gate
  blocking further processing until the person agrees — was not built. The
  three disclosures are sent; nothing yet tracks whether they were
  acknowledged, because there is no downstream model turn (B1056) for an
  unacknowledged consent to gate the first place. Building the gate before
  there is anything to gate would have been speculative. Flag this for
  whoever builds B1056: the consent state has to exist by the time a model
  turn does.
- **A `wa.me` entry point with a prefilled first message**, and a one-time
  linking code for an owner already signed in — both listed in the ticket's
  Work section, both about *discovery* of the channel rather than the
  webhook's own correctness, and neither has a page to add them to yet.
  Captured as B1127 (`npm run tasks -- new`) rather than built speculatively.

Evidence: `test/whatsapp-binding.test.ts` (2 tests) — a stranger gets exactly
one fixed reply and no journal is touched; a bound number's first message is
greeted once, in German (the journal's `defaultLocale`), carrying its own
`fernscout.ch/severin`-shaped URL, and a second message from the same number
gets no further fixed reply. `test/whatsapp-webhook.test.ts` and
`test/registry.test.ts` still pass with the real dispatcher wired in (they
previously only exercised the B1057 logging placeholder). Pure backend; the
only visible face is the two chat bubbles the mockup already showed, which
this build's copy matches in substance if not verbatim (the "yes" prompt was
deliberately dropped — see above).
