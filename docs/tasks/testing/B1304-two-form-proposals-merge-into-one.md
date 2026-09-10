---
id: B1304
title: Two form proposals merge into one message with one button set
type: ISSUE
priority: high
complexity: low
area: whatsapp, helper, honesty
found: "2026-09-10T11:51:13Z"
merged: "2026-09-10T12:27:09Z"
---

# B1304 — Two form proposals merge into one message with one button set

## Why

scenario-multimsg.md defect 1, reproduced directly against the real
`runTool`/`renderForWhatsapp` (`MESSAGE COUNT: 1` for two real `start_day`
proposals). `lib/helper/tools/areas/days.ts`'s `start_day` (and every other
tool declared `renders: "form"`) has no WhatsApp shape of its own —
`lib/whatsapp/render.ts`'s `case "form":` only ever accumulated into the
running body, on the theory that `lib/whatsapp/dispatch.ts`'s own
upgrade-to-buttons fallback would always find it as "the last message" and
turn it into real buttons. That held for exactly one proposal a turn. With
two, everything accumulated after the primary's own `form` block — a demoted
second proposal's own honest `wa.secondProposalNote` wait-sentence, and the
model's trailing prose — kept piling into the *same* running body, so the
eventual buttons ended up glued to prose describing a second, unrelated day.
B1261's own acceptance line ("its buttons never mention the second proposal")
was violated in substance even though nothing said was literally false.

## Work

- `lib/whatsapp/render.ts`'s `case "form":` now flushes onto its own tagged
  message when the block carries a `.proposal` — exactly the way `case
  "confirm":` already does (`messages.push(...); flush();`), giving the
  primary proposal a message that names only itself regardless of what a
  second proposal or the model's own trailing sentence adds afterward. A
  `form` block with no `.proposal` (there is none today, per
  `lib/helper/tools/run.ts:149`, the only producer) keeps the old
  accumulate-only behaviour, defensively.
- `lib/whatsapp/dispatch.ts`'s upgrade-to-buttons step now finds the message
  to upgrade **by tag** (`messages.findIndex((m) => m.proposal === proposal)`)
  rather than by position ("the last message") — position was the actual
  bug: with two proposals, "the last message" was whatever the *second*
  proposal's demoted text and the trailing prose had accumulated into, not
  the primary's own content.
- Existing tests that asserted the old (buggy) single-message shape for a
  single form proposal with trailing model prose
  (`test/whatsapp-model-turn.test.ts`'s screen-claim tests,
  `test/whatsapp-proposal-press.test.ts`'s several `.at(-1)` lookups) are
  updated to find the buttons message by kind rather than by position — this
  is a real, intended shape change: `form` now behaves exactly like
  `confirm` already did, where trailing content after the flush becomes its
  own subsequent message rather than folding onto the buttons.

## Investigation: scenario-costs.md defect F (stale day, wrong content glued
onto a proposal)

Root cause found, and **not** fixed here — it is not in the render/guard path
this ticket touches, and a wrong fix risks losing a legitimate proposal on a
retry that fixes other guard shapes correctly today.

`lib/helper/model.ts`'s `blocks` array (`const blocks: Block[] = []`,
~line 1614) is declared once per `answerInThread` call and `rounds()` pushes
onto it. On a failed honesty check, `rounds()` is called a **second** time
for the retry (~line 2009, `answer = withoutMarkers(await rounds())`) — but
`blocks` is never cleared first. Any block the *first, wrong* attempt drew
(a stale `read_day` preview from an earlier context, say) survives into the
final result unchanged, sitting beside whatever the retry itself drew. This
matches the observed leak exactly: `agent.block.day` ("Der Tag, wie er ist")
naming the wrong date (2026-09-10, not the 2026-09-11 day actually being
proposed), glued in front of the `agent.noScreenHere` fallback text from the
`claimsAChatScreen`/B1237 guard's own failed retry.

Why not fixed here: whether it is safe to clear `blocks` before a retry
depends on *which* guard fired. Several checks (`day`, `total` — the ones
that ask the model to actually call `read_day`/`trip_costs` on retry) *want*
the retry's own tool call to draw a fresh block, and that is already the
correct, desired behaviour today. Others (a false "claim" with a proposal
genuinely still pending) may need the *first* attempt's proposal block kept,
since the model may not re-propose it on a retry that only corrects wording.
Blanket-clearing `blocks` before every retry risks turning a working
proposal into a lost one on exactly the turns B943/B944 were built to
protect. The right fix is more surgical than this ticket's scope and needs
its own test coverage across `RETRY`'s dozen guard shapes; captured here for
whoever picks it up next rather than guessed at.

## Acceptance

- `test/whatsapp-proposal-press.test.ts` ("a turn that proposes twice —
  B1261"): exactly one buttons message, its body never contains the second
  proposal's own content, and the second proposal's honest wait-note is a
  separate message.
- `test/whatsapp-model-turn.test.ts` ("a claim about a screen or a page, on
  WhatsApp"): the buttons message never contains the guard's own retried
  text; the corrected trailing sentence is its own subsequent message.
