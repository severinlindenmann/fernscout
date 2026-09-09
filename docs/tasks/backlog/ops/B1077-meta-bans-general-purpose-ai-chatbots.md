---
id: B1077
title: Meta bans general-purpose AI chatbots on WhatsApp, and nothing establishes which side of that line the helper is on
type: OPS
priority: high
complexity: low
area: whatsapp, meta policy, compliance
found: "2026-09-09T11:00:03Z"
---

# B1077 — Meta bans general-purpose AI chatbots on WhatsApp, and nothing establishes which side of that line the helper is on

## Why

**Meta prohibits general-purpose AI chatbots on the WhatsApp Business
Platform.** In force for accounts registered on or after **15 October 2025**,
and for every existing account from **15 January 2026**. Both dates are in the
past. This instance's number was registered around September 2026 (B403), so
the rule applies to it now and has since the day it was created.

The four criteria reported for what counts as banned:

| Criterion | Fernscout's helper |
| --- | --- |
| Powered by a large language model | **Yes** |
| Supports open-domain conversation — ask it anything | No |
| Not restricted to a specific business process | No — 43 tools, all about one journal |
| Functions as a general assistant distributed through WhatsApp | No |

One of four. Structured, task-oriented assistants — support, bookings, order
management — remain explicitly permitted and encouraged. A helper that writes
somebody's travel journal is that shape, and the codebase is unusually well
placed to prove it: the tool registry is a closed list, `lib/helper/intents.ts`
refuses whole categories of request before the model is reached, and the
system prompt states what cannot be done at all.

**So the answer is almost certainly "we are fine". This ticket exists because
"almost certainly" is not a thing to discover during an account review**, and
because the cost of being wrong is the number being disabled, which takes down
the reader announcements too — a feature that has nothing to do with this and
that other people depend on.

*Sourced from secondary reporting on Meta's policy update, corroborated across
several independent write-ups. **Read Meta's own Business Messaging Policy
before relying on the table above**; the criteria are quoted second-hand.*

## Work

Not a diff. A page, and two things that go into other tickets.

- **Read Meta's own policy text**, not a summary of it, and record what it
  actually says beside the table above. Correct the table where it is wrong.
- **Write the compliance argument down** — one page, in the operator's own
  file: what the helper is scoped to, what it refuses, and why that is a
  business process rather than an assistant. This is the document produced if
  an account review ever asks. It is cheap now and impossible to write
  calmly later.
- **Two consequences belong to other tickets and should be cross-referenced
  rather than duplicated:**
  - **The first message must disclose that this is an AI**, with a route to a
    human. Reported as part of the same policy update, and independently
    likely required by the EU AI Act's transparency duty for systems
    interacting with people — which bites for the German, Austrian and
    Hungarian readers. The route to a human is `agent@fernscout.ch`. Goes in
    B1057's copy and B1063's page.
  - **Opt-out keyword handling is a policy requirement**, not a courtesy, and
    failure risks account restriction. That is B1062, and it raises its
    priority: it stops being a nicety and becomes a condition of shipping.
    Note also that it must be matched **before the model sees the message** —
    which is exactly what `lib/helper/intents.ts` already does for
    destructive and bulk-publish language, so the mechanism exists.

## Acceptance

A page exists that answers "is this permitted?" with Meta's own words and this
instance's own facts, and the two consequences are recorded in B1057 and B1062
rather than only here.

## Corrected — 2026-09-09, same day

A second research pass reached the **WhatsApp Business Solution Terms**
themselves, and two things above need fixing. Both corrections make this
ticket more useful, not less.

### The real test is one sentence, and it is better than the table

The operative clause, verbatim from
`whatsapp.com/legal/business-solution-terms`:

> *"Providers and developers of artificial intelligence or machine learning
> technologies, including but not limited to large language models,
> generative artificial intelligence platforms, general-purpose artificial
> intelligence assistants, or similar technologies … are strictly prohibited
> from accessing or using the WhatsApp Business Solution … for the purposes of
> providing, delivering, offering, selling, or otherwise making available such
> technologies **when such technologies are the primary (rather than incidental
> or ancillary) functionality being made available for use**, as determined by
> Meta in its sole discretion."*

**The four-criteria table above is secondary reporting.** This sentence is the
actual rule, and it turns on one question: is the language model the *primary*
thing being offered, or is it incidental to something else?

For Fernscout that reads well. The product is a travel journal — markdown and
photographs in a folder the author owns — and the model is how words get into
it. Nobody would describe the journal as incidental to the model. Meta has
also been reported as confirming that a travel company's scoped customer
service bot is fine.

But note the last five words: **"as determined by Meta in its sole
discretion."** There is no bright-line technical test to pass, which is exactly
why the compliance page in the Work section is worth writing — it is the
argument, prepared calmly, for a conversation that would otherwise happen
under time pressure.

### The opt-out claim above is too strong

I wrote that honouring an opt-out keyword *"is a policy requirement, not a
courtesy, and failure risks account restriction."* The wording that could
actually be retrieved from Meta is softer:

> *"Businesses should … provide clear instructions for how people can opt out
> of receiving specific categories of messages, and honor these requests."*

An obligation to **honour** opt-out requests, with no explicit mandate that a
literal `STOP` be recognised programmatically — unlike the SMS world, where
CTIA rules do require it. The dedicated Business Messaging Policy page now
404s and appears to have been folded into the Business Solution Terms, which
is part of why this is hard to pin down.

**This does not change what to build.** B1062 should still ship with the
channel, and it should still match the word before the model sees it — an
obligation to honour a request you have no mechanism to notice is not one you
can keep. What changes is the *reason* given: it is honouring an opt-out the
way this product honours things, not a compliance box. B1062's own decision —
reply with the manage link, ignore the word from an owner — is unaffected and
remains the right shape.

**The AI-disclosure-in-the-first-message requirement is in the same
category**: widely reported, not verbatim-citable from a Meta page that would
render. The EU AI Act's transparency duty for systems interacting with people
is the firmer of the two grounds for the German, Austrian and Hungarian
readers. Do it — it costs one sentence and it is honest — but do not record it
as a Meta mandate until somebody has read it in Meta's own words.

### What this ticket now needs

Unchanged in substance: read the primary text, write the argument down. The
difference is that the primary text has now been partly located — the Business
Solution Terms, not a policy page — so the first step is shorter than it was
this morning.
