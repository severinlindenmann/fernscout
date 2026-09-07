---
id: B891
title: The helper can answer but it still cannot do anything
type: FEATURE
priority: high
complexity: high
area: agent
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
`lib/rateLimit.ts` rather than by the ledger. Confirm with the owner before
building the metering; it is his money and the shape changed.

**When a proposal is wrong**, the person edits it in the conversation rather
than starting again. That is the difference between this and a form.

## Acceptance

"Ich war gestern in Lissabon, schreib das auf" produces a proposal naming the
day, the trip and the words, writes nothing until it is pressed, and can be
corrected by saying what is wrong.
