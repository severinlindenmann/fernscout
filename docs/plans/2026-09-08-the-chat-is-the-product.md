# The chat is the product

*Written 2026-09-08. The owner's decision: "the goal is to really work
agentic, the user should only type chat messages, voice inputs, upload file and
max select a few panes for options — but everything through the chat managed."*

## What this replaces

Six wizard steps, four owner tiles, an ask box, an inbox screen and a signup
form become **one conversation**, on every device. A person types, speaks,
drops a file in, and presses the occasional small option — public or private,
yes or no. Nothing else.

**One thing does not go**, and it is not a hedge: with the `helper` capability
**off** — the default, and what every self-hoster has — there is no model, so
there is no conversation. The wizard stays as that fallback, unreachable and
unadvertised when the chat is on. AGENTS.md's rule is that a capability must be
*absent rather than broken*; a product whose only way to write a day needs an
API key is broken without one.

## The shape

### Desktop, three panes

```
┌───────────────┬────────────────────────────┬────────────────┐
│  FILES        │  CONVERSATION              │  PREVIEW       │
│               │                            │                │
│  inbox        │  ▸ you: create a day for   │  ┌──────────┐  │
│  ▫ ▫ ▫ ▫      │       yesterday            │  │ day card │  │
│  ▫ ▫ ▫        │                            │  │ filling  │  │
│               │  ▸ helper: which trip?     │  │ in as    │  │
│  this trip    │       [Portugal] [Japan]   │  │ you talk │  │
│  ▫ ▫ ▫ ▫ ▫ ▫  │                            │  └──────────┘  │
│  ▫ ▫ ▫ ▫ ▫ ▫  │  ┌──────────────────────┐  │                │
│               │  │ 🎙  type or speak     │  │                │
│  [select]     │  └──────────────────────┘  │                │
└───────────────┴────────────────────────────┴────────────────┘
```

- **Left — files.** The inbox *and* this trip's photographs, tiny thumbnails,
  multi-select. Selecting some and saying "put these on yesterday" works. This
  is also what finally makes the inbox reachable: the statement reader and the
  GPS import have been built and unreachable since B689 because no picker would
  accept the file.
- **Middle — the conversation.** The only place anything is done.
- **Right — the preview.** Whatever the conversation is currently about,
  **updating as it goes**. Say "create a day for yesterday" and the day card
  appears and fills in — photographs land, words land, the weather arrives.
  It is the answer to "show me how it would look", and it is what makes
  propose-then-press obvious: you watch the thing you are about to accept.

### Mobile, one thing at a time

The conversation is the screen. Two things slide over it and slide away:

- **Files** — a sheet from the bottom, dragged up, the same thumbnails and the
  same selection.
- **Preview** — full screen, from a button on the message it belongs to, with
  one obvious way back to the conversation.

Nothing is ever half a screen wide on a phone.

## The message vocabulary

**A tool declares how its result renders. The model chooses tools and never
chooses a shape.** That is the whole safety argument: the model cannot ask for
a component nobody built, a new capability is one tool with one declared shape,
and every shape is testable before anybody sees it.

Seven, and adding an eighth needs an argument:

| | | |
| --- | --- | --- |
| `say` | prose, nothing to press | "you have 10 credits" |
| `choose` | a short list to pick from | which trip, which category |
| `form` | a few fields to check before a write | title, dates, visibility |
| `preview` | a rendered thing | the day card, the costs summary |
| `files` | photographs or documents to select | pick from the inbox |
| `confirm` | one press, with a sentence about what happens | publish, take down |
| `link` | hand off to a page that must stay where it is | postcards, deletion |

`link` is the one that matters most for safety. Postcard sending and journal
deletion do not become chat actions — they become a sentence and a link to the
page where a person presses, exactly as they are now.

## Reads run, writes propose

Unchanged from the plan this succeeds, and it is what makes the loop safe:

- A **read** tool executes immediately. There is nothing to confirm about a
  question, and reads cost nothing but tokens.
- A **write** tool never writes. It returns a **proposal** — the tool, the
  arguments filled in, a sentence saying what will happen — rendered as a
  `form` or a `confirm`. The person presses, edits a field, or says what is
  wrong and the conversation carries on.

**Correcting a proposal by saying what is wrong** is the difference between
this and a form. That sentence is the product.

## What must survive being made conversational

Every one of these is a place where "everything through the chat" could quietly
file a safety off. They are not negotiable and each has a test today:

- **Publishing** is a press after a preview. It never fires from a sentence.
- **Removal language never reaches the model** — the pre-router table (B817)
  stays in front of the whole loop, refusing before any tool is chosen.
- **Deletion has no tool.** Asking answers that a mail is waiting, and links to
  nothing that finishes it.
- **Postcards have no send tool.** A `link` to the owner's own preview page,
  where addresses live and where the press happens. `test/postcard-orders.test.ts`
  fails if anything under `app/api` imports `sendOrder`.
- **Guest and buddy links are different tools**, and only the guest one is in
  the chat.
- **Trip visibility is asked**, in words that separate "everyone I let into
  this journal" from "the people who were there".
- **The model never writes weather and never invents what happened.**
- **No tool reads `gps/`.**
- **Nothing over HTTP grants credits**, and the signup grant stays below the
  cheapest thing a printer bills for.

## Checklists

The owner asked for these first, so they are the contract for the work rather
than a summary of it.

### A. The contract

- [ ] A `Tool` type: name, arguments schema, `kind: "read" | "write" | "link"`,
      and `renders` from the seven shapes
- [ ] One registry; the model's tool list is generated from it, never typed
- [ ] A read executes and returns its rendered block
- [ ] A write returns a proposal and touches nothing
- [ ] A link returns a sentence and a URL and touches nothing
- [ ] Adding a tool requires no client change
- [ ] Test: every tool in the registry declares a shape the client can render
- [ ] Test: no write tool can reach disk without an accepted proposal

### B. The conversation

- [ ] Turns kept in order, visible, scrollable
- [ ] The field stays at the bottom and keeps focus after sending
- [ ] Something honest while it thinks
- [ ] Voice into the same field (B893), transcript editable before sending
- [ ] A way to start over (`forget()` exists and nothing calls it)
- [ ] Errors are said in the conversation, not swallowed
- [ ] Test: a second turn does not repeat the first
- [ ] Test: a refused sentence never enters the thread

### C. The three panes

- [ ] Desktop: files, conversation, preview
- [ ] Files: inbox + this trip's photographs, tiny thumbnails, multi-select
- [ ] Selection is referable — "put these on yesterday" resolves to it
- [ ] Preview follows the conversation and updates as it goes
- [ ] Mobile: conversation is the screen; files a bottom sheet; preview
      full screen with one way back
- [ ] Nothing is half a screen wide on a phone
- [ ] Test: at 390px no pane competes with the conversation

### D. Reach

- [ ] Every block type is keyboard-operable
- [ ] Each new message announced once, not on every token
- [ ] Focus moves to a proposal when it appears; back to the field after
- [ ] The field is reachable with the keyboard open at 390px
- [ ] Contrast holds in both themes
- [ ] Test: a screen reader can complete a day without sight

### E. Honesty

- [ ] Consent names what leaves the instance, including the conversation
- [ ] A price is stated before a spend, once
- [ ] A proposal says what will happen in the person's language
- [ ] Nothing claims success it does not have
- [ ] Every gate above has a test that fails if it is removed

### F. Proof

- [ ] The ten-sentence baseline scores zero `unknown`
- [ ] A day written end to end by conversation alone, on a phone
- [ ] The same by keyboard only
- [ ] The same in German and in Hungarian
- [ ] Personas: 71, 23, 47, blind, Hungarian — desktop and phone
- [ ] The capability off still leaves a usable product

## Order

| | |
| --- | --- |
| 1 | The tool contract and the twelve tools that matter |
| 2 | The conversation surface — turns, field, blocks |
| 3 | Proposals: `form` and `confirm`, and accepting one |
| 4 | The three panes on desktop |
| 5 | Mobile: sheet and full-screen preview |
| 6 | Files: selection, and saying something about a selection |
| 7 | Voice into the field |
| 8 | Personas, on both shapes, in three languages |

Rounds 1–3 are a usable product. Everything after is the ecosystem.
