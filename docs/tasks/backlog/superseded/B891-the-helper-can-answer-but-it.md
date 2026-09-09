---
id: B891
title: The helper can answer but it still cannot do anything
type: FEATURE
priority: high
complexity: high
area: agent
superseded: "B900 and the chain after it. The write-tools-as-proposals mechanism this ticket asks for is built: lib/helper/tools.ts carries create_trip, start_day, draft_words, set_day_words, add_cost, publish_day, unpublish_day, attach_files, invite_guest and add_photos, all returning proposals only."
found: "2026-09-07T18:29:57Z"
---

# B891 — The helper can answer but it still cannot do anything

## Why

Round 2 of `docs/plans/2026-09-07-helper-as-an-agent.md`.

B889 gave the helper a thread and read tools, so it can now answer what it is
asked. It still cannot **do** anything — which is the half the owner actually
asked for: *"the feel should be more like an agent does the work and proposes
for you"*.

A helper that answers questions and then tells you to go and press something
yourself is a better menu, not an agent.

## Work

**Write tools that never write.** A write tool returns a **proposal**: the tool
name, the arguments filled in, and a sentence saying plainly what will happen.
The person presses, edits a field, or says no in words and the conversation
carries on. Nothing reaches the disk until the press.

Start with the three that already exist behind forms, because their shapes are
proven and their refusals are written:

- `start_day` — a date and a trip
- `set_words` — the day's title and prose
- `add_cost` — an amount, a currency, a label, a date, a category

Then the rest: `create_trip` (with the visibility question asked, B731),
`add_photos`, `caption_photos`, `invite_guest` (guest link only, never buddy),
`notify_readers`, `publish`, `unpublish`.

**The gates do not move**, and the proposal shape is what keeps them cheap:

- **Publishing is a press after a preview.** A publish proposal shows the day
  as a reader will see it, exactly as the wizard's preview step does.
- **Removal language never reaches the model** (B817). The pre-router table
  stays in front of everything.
- **Deletion has no tool.** Asking to delete answers that a mail is waiting and
  nothing else; the helper never follows that link.
- **Postcards have no send tool.** A proposal may only ever open the existing
  preview page, where the owner presses. Nothing under `app/api` imports
  `sendOrder` and that test must keep passing.
- **A guest link and a buddy link are different tools**, and only the guest one
  exists here.
- The model never writes weather, never invents what happened, never
  translates.

**Charging.** The plan proposes: a conversation costs nothing until a write is
accepted, and the credit is charged on the write, as today. So somebody who
chats and accepts nothing pays nothing, and the exposure is bounded by
`lib/rateLimit.ts` rather than by the ledger. **The owner approved this on 2026-09-07** — "cost is good" — so build it: a
conversation is free, the credit is charged when a write is accepted, and the
rate limit is what bounds somebody who only ever chats.

**B922 resolved what "as today" means, and it stays true here.** *Answering* —
reading tools, a question, a fact looked up — is free, as it already is for
B889's thread. But **filling in a proposal is the model call that costs
money, and that is the event that is charged**, exactly as `write-day`
charges today: before the call, refunded only if the provider call itself
fails, never refunded because the person edited the proposal three times or
declined it outright. "The credit is charged when a write is accepted" does
**not** mean the charge waits for the press on the proposal card — it means
the same thing `write-day` already means by "write": the model doing the
work of turning notes into a day, a cost, a caption. Pressing "yes" is a free
disk write, exactly as `PATCH` on a day is free today; declining a proposal
that cost a credit to produce is not refunded, for the same reason a draft
read and not kept is not refunded (see B922's trace). A person who edits a
proposal three times before accepting has caused three model calls and three
charges, each a real one — the "free to correct" language above is about
letters typed *inside* the conversation, not about how many times the model
has to be asked to try again.

The ledger names a refund as its own line (`spentByReason` → `refunded`,
B922) so a person can tell a charged call apart from one that came back,
whichever tool produced it.

Two things that follow and are not optional:

- **Say what a turn costs somewhere an operator can see it.** A conversation
  that is free to the journal is not free to the instance, and `/api/health`
  or the ledger should carry enough for the operator to know what a busy day
  costs them.
- **A refused or abandoned proposal charges nothing**, including one the person
  edits three times before accepting. The credit belongs to the write, not to
  the asking.

**When a proposal is wrong**, the person edits it in the conversation rather
than starting again. That is the difference between this and a form.

## Acceptance

"Ich war gestern in Lissabon, schreib das auf" produces a proposal naming the
day, the trip and the words, writes nothing until it is pressed, and can be
corrected by saying what is wrong.

## What happened instead — 2026-09-09

Re-validated before starting. **This is built.** Not partly — the mechanism
this ticket describes is on `main` and has been iterated on for several
ticket-generations since.

`lib/helper/tools.ts` (1557 lines) carries the write tools: `create_trip`
(with the visibility select B731 asked for), `start_day`, `draft_words`,
`set_day_words`, `add_cost` (with currency and `COST_CATEGORIES` dropdowns),
`publish_day`, `unpublish_day`, `attach_files`, `invite_guest` (guest-only, as
this ticket required) and `add_photos`. Every one of them returns a proposal
and writes nothing. There is no delete tool and no postcard-send tool, which
matches this ticket's own "not doing" list.

`lib/helper/model.ts` carries the net: `proposals: Proposal[]` on every turn,
and `HONESTY_RETRY` / `PENDING_RETRY` / `WORDS_RETRY` catching the model
claiming a save or a publish happened when no proposal was on the turn. Its
comment states the rule this ticket was written to establish: *"a write tool
does not write, it puts a proposal on their screen... only their press changes
anything."*

Two names from this ticket's tool list — `caption_photos` and `notify_readers`
— do not appear in `tools.ts` under those names. That is the only residual, and
it is captured separately rather than keeping a ticket open whose body
describes work already done.

Closed as superseded. The live successors are B1041 and B1038.
