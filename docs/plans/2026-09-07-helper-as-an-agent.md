# Making the helper an agent rather than a menu

*Written 2026-09-07, after the owner used the thing we built and said it does
not work. He is right, and this document starts by saying why, because the
reason is a decision I recommended.*

## What is wrong, in the owner's words

> "why does he not work almost for everything that I ask"
> "what is up with 'Die Knöpfe darunter'? which buttons?"
> "the feel should be more like an agent does the work and proposes for you,
> but you can continue to chat with him"

Measured against the live instance the same afternoon, with seven ordinary
German sentences:

| said | answered |
| --- | --- |
| mach mir einen tag von gestern | opened the wizard |
| schreib den tag fertig | opened the wizard |
| zeig mir meine reisen | one trip's dates |
| **wie geht das hier** | unknown |
| **ich war in lissabon** | unknown |
| **was kostet das** | unknown |
| **füge ein foto hinzu** | unknown |

Four of seven. And `agent.askUnknown` — *"Die Knöpfe darunter machen alles von
Hand"* — was written when the box lived on `/agent` with buttons beneath it.
B844 moved it onto the day page, where the tiles are **above**. Nobody updated
the sentence, so the software points at furniture that is not there.

## Why it is like this, honestly

The first design question of this whole feature offered two answers, and the
recommendation in this document's own lineage was the wrong one for what the
owner wanted:

- **A conversational agent with tools** — flexible, handles anything the API
  supports without new UI, every turn is a model call.
- **Wizard rails with a router** — cheap, testable, predictable. *Recommended.*

The router was chosen for good reasons and it did its job: it is safe, it
refuses destructive language before the model sees it, it costs a third of a
rappen, and every one of its answers is checkable. But it can only ever answer
what somebody wrote a row for. **Seven rows is a menu with a text box in front
of it.** "Ich war in Lissabon" is not a command and never will be; it is a
person telling their journal something, and a menu has nowhere to put it.

`unknown` is a first-class answer — that was right, and it is what stops wrong
guesses. It is the wrong *primary* experience.

## What the owner is asking for

Three things, and they are separable:

1. **It should do the work**, not open a form for the person to do it.
2. **It should propose** — offer what it thinks, and let a person accept, edit
   or ignore.
3. **It should feel like a conversation** somebody already knows how to have,
   with the manual controls still there for anyone who prefers them.

## The design

**A thread, a model with tools, and a confirmation before anything is written.**

### The loop

One conversation per journal, kept server-side. Each turn:

1. The person says something, typed or spoken.
2. The model is called with the conversation so far and a **tool list**, not an
   intent list.
3. It may call **read** tools freely — what trips exist, what is unfinished,
   what a day says, what the storage and credits are, what a trip cost. Reads
   are free of consequence and should not be confirmed.
4. When it wants to **write**, it does not write. It produces a **proposal**:
   the tool, the arguments, and a sentence saying what will happen. The person
   presses, edits, or says no in words.
5. It answers in prose, in the person's language, and says what it did.

### Tools, not rows

The registry becomes a tool schema. Everything the helper routes already do is
a tool the model may call, and the two halves stay split exactly as they are
now — a read tool executes immediately; a write tool returns a proposal.

Reads: `list_trips`, `unfinished`, `read_day`, `trip_costs`, `storage`,
`credits`, `who_can_read`.
Writes: `create_trip`, `start_day`, `set_words`, `add_cost`, `add_photos`,
`caption_photos`, `publish`, `unpublish`, `invite_guest`, `notify_readers`.

Adding a capability becomes one tool, and — this is the point — **a sentence
nobody anticipated is answered by the model choosing among tools rather than by
somebody having written a row for that sentence.**

### What does not change

Every gate in `2026-09-07-helper-everything.md` still stands, and the loop
makes them cheaper to keep rather than harder:

- **Publishing stays a person's press**, after a preview. A tool that publishes
  produces a proposal like any other; it never fires from a sentence.
- **Removal language is refused before the model is called** (B817). Keep the
  pre-router table exactly as it is — it is the one thing that must not depend
  on the model's judgement.
- **Deletion still ends in a mailbox.** The tool that asks to delete reports
  that a mail is waiting and nothing else.
- **Postcards are still previewed and pressed by the owner**, addresses never
  reach the model, nothing under `app/api` imports `sendOrder`.
- **The model still never writes weather and never invents what happened.**
  The write-day prompt's rules move into the loop unchanged.
- **`gps/` stays unreachable.** No tool reads it.

### What it costs

This is the honest part. A router turn is one small call. An agent turn is the
conversation so far plus a tool list, and a task takes several turns. Roughly
ten to thirty times the tokens per interaction.

That is affordable — Haiku at $1/$5 per MTok makes a busy session a few
rappen — but it must be **metered and visible**, and it changes the pricing
shape: today asking is free and doing costs; in a loop, asking *is* doing.
Proposal: a conversation costs nothing until a write is accepted, and the
credit is charged on the write, as now. A person who chats and accepts nothing
pays nothing, and abuse is bounded by the existing rate limit.

### Keeping the manual path

The wizard, the tiles and the forms all stay. They are what the loop falls back
to, what somebody who dislikes chat uses, and what works when the `helper`
capability is off — which is still the default and still what every self-hoster
has. **The agent is an accelerator over a product that works without it.**

## The rounds

| | |
| --- | --- |
| **0** | The sentence that points at buttons which are not there, and the other stale strings. One afternoon, and it is what the owner is looking at |
| **1** | The thread: conversation state, a chat surface, and the model answering in prose with the read tools only. Nothing writes. This alone answers "wie geht das hier" and "was kostet das" |
| **2** | Write tools as proposals, starting with the three that already exist behind forms — start a day, set the words, add a cost |
| **3** | The rest of the writes, and the wizard becoming what a proposal opens when somebody wants the long way |
| **4** | Voice into the thread, so the whole product is speakable |

Round 1 is the one that changes the feel, and it cannot write anything, which
makes it the cheapest possible way to find out whether this is the right
direction before committing to the rest.

## What would say this was wrong

Worth writing down before building it, because it is easy to fall in love with
a loop:

- If people ask for things and it proposes the wrong tool confidently, that is
  B817 and B829 at a larger scale, and the answer is fewer tools, not better
  prompts.
- If a conversation costs more than the day is worth, the metering has to
  become visible in a way B767 spent effort removing.
- If the thread makes the manual controls harder to find, the people this
  product was built for — the 71-year-old, the 23-year-old — lose the thing
  that was working for them.

Measure it the way everything else here has been measured: the same personas,
the same sentences, before and after.
