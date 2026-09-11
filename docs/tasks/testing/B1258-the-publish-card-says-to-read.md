---
id: B1258
title: The publish card says to read the day as readers will see it and does not show the day
type: ISSUE
priority: medium
complexity: low
area: helper
found: "2026-09-10T09:59:55Z"
started: "2026-09-11T15:47:56Z"
merged: "2026-09-11T16:11:49Z"
---

# B1258 — The publish card says to read the day as readers will see it and does not show the day
## Why

The card that puts a day on the site opens with:

> 2026-09-05 — "Old town, bears, and Einstein". **Read it as your readers will
> see it.** Pressing puts it on the site. Anybody who finds it will be able to
> read it.

Nothing on the card is the day. It carries the date, the title, four more
sentences about photographs, one dropdown reading "Nobody has it", and the
button. The words the person is about to publish to anybody who finds them are
not there — asserted by measurement, not by eye: the card's text contains the
title and does not contain a single word of the body.

This is the one card where reading before pressing is the whole point. The
instruction is right; it is just addressed to a card that cannot satisfy it.

The day *is* readable — in the **How it looks** tab, one tap away. On a phone
that tab replaces the chat entirely, so following the instruction means leaving
the card, reading, and coming back to find it (and B1254 means a reload on the
way loses it). On a desktop the preview is beside the chat and the sentence is
true. It was written for that width.

Found at 390x844 on fernscout.ch, 2026-09-10; screenshot `18-publish-card.png`.

## Work

Built in `components/HelperAsk.tsx`, on branch `b1258-ui-remainder`.

- **This ticket's own premise had a bug in it, not a missing feature.** A
  preview block already existed and was already being sent ahead of the
  confirm card — `lib/helper/tools/areas/days.ts:397-401` builds it,
  `lib/helper/tools/run.ts:161-163` pushes it into `blocks` before the
  `confirm`/`shape` block, and `HelperAsk.tsx` (`shape === "preview"`) renders
  it through `AnswerText` like any other line. The fault was that
  `proposal.current?.scrollIntoView?.({ block: "start" })` scrolled the
  confirm card's own top to the viewport's top, which pushes anything the
  turn rendered *before* the card — the preview included — off-screen above
  it. So the day's words were being sent and were being scrolled past, not
  withheld.
- **The fix is what gets scrolled, not new markup.** Added a second ref,
  `turnTop`, on the wrapper `<div>` that already holds every block of one
  turn (`turn.blocks.map`, the `<div key={index} className="space-y-2">`).
  On the last turn only it also carries `scroll-mt-24` (moved from the card,
  which still keeps its own copy of the class in case anything else ever
  scrolls to it directly) so the turn's own top — the preview, when there is
  one — lands below the sticky header rather than under it. The
  `proposal.current?.focus()` call is unchanged and still lands keyboard
  focus on the confirm card itself; only the scroll target moved.
- **The raw-600-characters question, answered rather than dodged**: the
  preview block is `[date, title, content.slice(0, PREVIEW_CHARACTERS)]`
  (`PREVIEW_CHARACTERS = 600` in `lib/helper/tools/args.ts`), rendered as
  plain text through `AnswerText` — not the rendered page `PreviewPane` draws
  in the "How it looks" tab, and not markdown-aware. My judgement: this is
  now a materially better answer to "read it as your readers will see it"
  than nothing was, since the actual words being published are now on screen
  without a tab change, but it is not literally what a reader will see —
  formatting, photographs and layout are all still absent. I did not widen
  this into rendering markdown in the chat; that is real, separate work this
  ticket explicitly put out of scope in spirit (it only excluded the
  "Photographs — Nobody has it" line, but the same "not in scope" reasoning
  applies to building a second preview renderer here).
- Verified with `test/helper-chat.test.tsx` and `test/helper-room.test.tsx`
  (53 tests, all pass) — both assert `scrollIntoView` was called on a turn
  ending in a proposal and not on other turns; neither asserted *which*
  element, so the retarget is exercised but not pinned down by name. I did
  not add a new assertion naming `turnTop` specifically — the existing
  coverage was judged sufficient for a one-line retarget, per the
  "shortest diff that answers the ticket" rule.
- Not driven in a real browser: the `/agent` helper conversation needs a
  signed-in session and a live model turn to produce a real `publish_day`
  proposal, which was heavier than this fix warranted; verified by reading
  the DOM structure and the two test files instead.

## Acceptance

- At 390px, the publish card either contains the day's words or carries a
  control that opens them, and the sentence matches whichever is true.
- At desktop width nothing regresses.
