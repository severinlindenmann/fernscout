# Is Fernscout's WhatsApp helper a general-purpose AI assistant?

B1077. **This is an argument, not a guarantee.** No document converts a
clause that ends "as determined by Meta in its sole discretion" into a
promise. What follows is the case for why this instance believes it is on
the permitted side of that line, written down calmly now rather than
composed under time pressure during an account review — and a record of who
accepted the residual risk that no argument can remove.

## The rule, in Meta's own words

Source: `whatsapp.com/legal/business-solution-terms`, the "AI Providers"
clause. Read 2026-09-10 and re-read 2026-09-11 to confirm it had not moved;
Meta's dedicated Business Messaging Policy page (a second, separate page
reported in earlier secondary write-ups) now 404s and appears to have been
folded into this document — so this Terms page, not that policy page, is
the one to re-check if this argument is ever revisited.

> "Providers and developers of artificial intelligence or machine learning
> technologies, including but not limited to large language models,
> generative artificial intelligence platforms, general-purpose artificial
> intelligence assistants, or similar technologies as determined by Meta in
> its sole discretion ("AI Providers"), are strictly prohibited from
> accessing or using the WhatsApp Business Solution, whether directly or
> indirectly, for the purposes of providing, delivering, offering, selling,
> or otherwise making available such technologies when such technologies
> are the primary (rather than incidental or ancillary) functionality being
> made available for use, as determined by Meta in its sole discretion."

Two things worth being precise about, since both were got wrong on the
first pass at this ticket (2026-09-09) and corrected the same day:

- **There is no opt-out clause on this page.** The restriction above is
  the whole of it, except for one exception below.
- **AI Providers may still be retained as a *Third Party Service
  Provider***, with a further restriction: Business Solution Data may not
  be used to create, develop, train or improve an AI model — except that a
  business may fine-tune a model for its own exclusive use. This is the
  shape Fernscout is actually in: Anthropic is the model provider behind
  the helper, retained as a third-party service, and no message sent
  through this channel trains anything. `lib/helper/consent.ts`'s own
  consent panel already promises this to the person on the other end of
  the conversation ("that it's not training data").

The operative question is therefore not the four-criteria table an earlier
pass at this ticket built from secondary reporting (open-domain? restricted
to a business process? general assistant?) — that table is still a useful
summary, but it is journalism about the rule, not the rule. The actual
question is narrower and harder to game: **is the language model the
primary thing this WhatsApp number offers, or is it incidental to
something else?**

## What Fernscout's WhatsApp number actually offers

The product is a travel journal: markdown and photographs in a folder the
author owns (`AGENTS.md`, "The one rule"). WhatsApp is one of two doors
into writing it — the other is the browser at `/agent` — and the model is
how a photo and a voice note become a paragraph in that folder. Nobody
would describe the journal as incidental to the model; it is the reverse.
The code makes that structural rather than a matter of prompting:

- **The tool registry is a closed list of 46 tools across 7 areas** —
  trips, days, money, files, readers, journal, printed
  (`lib/helper/tools/registry.ts`) — every one of them an operation on
  *this journal*. There is no tool that answers a question unrelated to
  the journal, and the system prompt states the boundary explicitly:
  "Never make up a tool, a page or a button that is not named above."
  (`lib/helper/model.ts`).
- **The system prompt routes software questions to written text, not to
  the model's own knowledge.** What the helper cannot do — delete
  anything, receive a file directly, finish anything that costs money or
  reaches a printer — is stated as a fixed list ("WHAT YOU STILL CANNOT
  DO, AND WHAT TO SAY INSTEAD"), so there is no open-domain path where a
  stranger's unrelated question gets an open-ended answer.
- **An unbound stranger's number never reaches a model at all.**
  `lib/whatsapp/dispatch.ts`'s handling of an unmatched number answers with
  a fixed sentence and, per its own comment, "no model call". The tel
  registry that resolves a number to a journal (`lib/registry.ts`'s
  `journalForNumber()`) is written by nothing but the journal owner's own
  proven number, so it is provably the owner, and nobody else, who ever
  reaches `answerOnWhatsapp` this way. The model is not a general assistant
  "distributed through WhatsApp" in any sense where a stranger — or even a
  buddy on one of the journal's trips — who messages the number gets a
  conversation with it.
- **WhatsApp's own execution table excludes the money- and deletion-shaped
  tools.** `lib/whatsapp/proposalExecution.ts`'s `ROUTE_BY_TOOL` is the
  closed list of tools this channel can actually press a button for; it
  has no entry for `propose_postcards`, `photobook`, `buy_credits`, or
  anything that deletes — those all end on the owner's own browser page,
  never on a WhatsApp tap. The channel that would be Meta's chief concern
  (a number that can be made to spend money or destroy something with a
  short exchange) structurally cannot.

## The two consequences this ticket flagged, and where they landed

B1077's own first pass flagged two things as needing to exist independently
of this argument. Both are built and both are a person's own decision
already recorded elsewhere, not repeated here:

- **B1063** (completed, person-verified) — the imprint names the model
  provider as a data processor, the legal ground this instance actually
  rests the "the model is not the primary offering, the journal is" case
  on for EU readers, corrected from an earlier over-reading of a Meta
  transparency mandate that turned out not to be verbatim-citable.
- **B1062** (completed, person-verified) — opt-out (`STOP`) is matched
  before the model ever sees the message
  (`lib/whatsapp/stop.ts`'s `isStopWord`, read in `dispatch.ts` ahead of
  any model turn), honoured the way this product honours a request rather
  than as a literal Meta mandate — no such mandate was found verbatim on
  this page, only a general duty to honour opt-out requests.
- **The first message already discloses the AI**, per `dispatch.ts`'s own
  module comment ("three disclosures — it's an AI, which journal, the
  consent notice") and `wa.firstReply`'s text ("I'm an AI, and your
  messages pass through WhatsApp and the model that writes them.").

## What is lost, and what remains, if this argument is wrong

This document generates no new evidence beyond the argument itself. If a
human reviewer at Meta reads the product differently, there is nothing
further here to point to beyond what already ships — B1062 and B1063 are
not hardened further by this page, only cited by it. The clause's own last
clause — "as determined by Meta in its sole discretion" — means no
document, however well-argued, converts this into a guarantee, and
disabling this number would also silence the day-announcement feature
(`docs/providers/whatsapp.md`) that has nothing to do with the
conversational channel and that other people depend on.

## Who accepted this

This argument, and the residual risk it cannot remove, was read and
accepted by **[operator's name — fill in before relying on this
document]**, the person who decides for this instance. No argument written
by an agent binds Meta's discretion, and nobody but a person can be the one
who decided to carry this on. Record the date accepted alongside the name
when that happens.

---

See `docs/providers/whatsapp.md` for the operational side of this channel —
the three subscriptions, the Feldprobe trap, rate limits — which this page
deliberately keeps out of, since a compliance argument belongs somewhere a
reviewer can be handed without the configuration noise around it.
