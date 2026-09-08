---
id: B971
title: Saying a draft looks good re-offers the same card instead of the next one
type: ISSUE
priority: medium
complexity: low
area: helper, model
found: "2026-09-08T13:59:02Z"
started: "2026-09-08T20:08:52Z"
session: bdd0270d-3797-42c9-8687-06abecadbc63
claimed: "2026-09-08T20:08:52Z"
---

# B971 — Saying a draft looks good re-offers the same card instead of the next one

## Why

The drafting chain is two presses on purpose: `draft_words` returns prose to
read, and keeping it is `set_day_words`. B969 made the person's own notes ride
into the first card. What happens after they read what came back is where it
stalls.

Having pressed and read the prose, the tester said the most ordinary sentence
in the flow:

> "That looks good, save it."

The conversation re-issued **the same `draft_words` proposal** — an offer to
write it up again, and to spend another credit — rather than the
`set_day_words` card that keeps what they had just read. Nothing was lost and
nothing was charged, because they did not press it. They built the next
proposal by calling `POST /api/helper/<user>/proposal` themselves, which is the
browser's own chaining call and not something a person has.

The mechanism is right and already exists: `Proposal.next` opens
`set_day_words` when the first card is pressed *in the browser*. What has no
answer is the person saying yes **in words** on the next turn, which is what
somebody does when they have just read something and liked it.

## Work

The model needs to know that prose was drafted and not yet kept, and B939's
notes are the place: `write-day` already leaves *"drafted: words for
<trip>/<date>, kept nowhere yet"*. So the fact is in the conversation and the
model is answering as though it were not — worth reading whether the note
reaches it before changing anything else.

Then the honest fix is probably that "save it", after such a note, means
`set_day_words` with the drafted prose — which the model cannot supply, because
it does not hold the prose. That may mean the note has to carry it, or that
this turn should re-propose from what the route returned rather than from the
model.

Not doing: making "looks good" press anything. The press stays a press.

## Acceptance

After a real `draft_words` press, "that looks good, save it" produces a
`set_day_words` proposal carrying the prose that came back — not a second offer
to write it.

## Found

Confirmed still real by reading the code as it stands today, before changing
anything.

`answerInThread` in `lib/helper/model.ts` folds a note onto the *next* user
message correctly — `[drafted: …]` was already timed right, arriving with
"that looks good, save it" rather than a turn late. That ruled out the timing
theory the Work section raised first.

What was missing was the content. `app/api/helper/[user]/day/write-day/route.ts`
wrote only `[drafted: words for <trip>/<date>, kept nowhere yet — the proposal
to keep them is on their screen]` — no title, no prose. `lib/helper/thread.ts`
keeps only plain turn *text* across a conversation (deliberately: "no tool
calls, no tool results," so trimming a history with orphaned `tool_result`
blocks can't 400 the next call), and a `draft_words` proposal's actual words
live only in the card's own form fields (`lib/helper/tools.ts`,
`renders: "form"`), which are drawn in the browser and never enter the
conversation as text. So on the next turn the model had the *fact* that a
draft existed and genuinely nothing of what it said — it could not supply
`set_day_words`'s `content` with the words the person had just read, only with
its own paraphrase of them, which the system prompt (`model.ts:535`, "what
draft_words made of their notes") tells it not to do. Calling `draft_words`
again was the model's honest way out of a paragraph it did not actually hold.

## Changed

`write-day/route.ts`'s note now carries the drafted `title` and `content`
(`written.prose`) verbatim, JSON-encoded (same pattern `wrote()` already uses
for `[written: …]` facts), together with an instruction to call
`set_day_words` with exactly that payload if the person agrees to keep it.
This is a data fix, not a prompt reword: AGENTS.md's rule that rewording never
fixed one of these and the note mechanism (B924/B939) already exists
precisely to tell the model facts about the turn, so this extends the same
mechanism to carry the one fact that was missing rather than adding new
instructions. No guard in `model.ts` needed changing — the model's honesty
checks compare what it *says* against what the turn *did*, and this changes
neither; it only lets the model give `set_day_words` real content instead of
none.

Test: `test/helper-write-day.test.ts`, "the note carries the drafted title and
prose, not just that one exists" — fails against the old note text (asserted
by hand, see below) and passes now.

```
$ git stash push -- app/api/helper/[user]/day/write-day/route.ts
$ npx vitest run test/helper-write-day.test.ts -t "carries the drafted title"
  FAIL — text was "[drafted: words for a-trip/2026-05-04, kept nowhere yet —
  the proposal to keep them is on their screen]", no set_day_words, no prose.
$ git stash pop
$ npx vitest run test/helper-write-day.test.ts
  15 passed
```

`npm run verify`: build → tsc → eslint → 5759 tests passed (4 skipped,
pre-existing/unrelated) → knip clean. Full pass, no known-noise failures hit.

## Acceptance, walked

- "After a real `draft_words` press, ... produces a `set_day_words` proposal
  carrying the prose that came back" — the note the model reads after a
  `draft_words` press now contains `set_day_words` and the exact `title` and
  `content` (`written.title` / `written.prose`) the route returned, so a
  model that follows the note (which its own system prompt already tells it
  `set_day_words`'s content should be) calls `set_day_words` with those words
  rather than inventing new ones. Covered by the new test; a live model call
  was not driven for this fix (the existing test suite for this route stubs
  `writeDay` deliberately — "what a model says is not assertable" — and this
  fix is about what the model is *given*, not about asserting model output).
- "not a second offer to write it" — nothing here removes the model's ability
  to call `draft_words` again if genuinely asked to redraft; what changes is
  that it is no longer the *only* thing it can do when it has nothing else to
  answer "save it" with.

## Shares a root cause with B926?

Likely related but not the same mechanism. B926 ("the helper forgets what it
was told one message ago") sounds like it could be about `MAX_TURNS` trimming
or about notes/turns not surviving as expected; this ticket's root cause was
narrower and different — not memory loss, but a specific write route's note
never having carried the payload a later tool call needs. Worth the next
reader of B926 checking whether its repro is *this* shape (a proposal's real
content, shown only in form fields, never entering conversation text) before
assuming it needs the general trimming/memory logic touched. Not changed or
taken on here.
