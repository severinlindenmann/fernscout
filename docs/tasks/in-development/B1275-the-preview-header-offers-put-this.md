---
id: B1275
title: The preview header offers Put this day on the site, which does not put the day on the site
type: ISSUE
priority: high
complexity: low
area: helper, publishing
found: "2026-09-10T10:23:09Z"
started: "2026-09-11T06:40:34Z"
session: 13f12910-ff28-4566-894a-9e2b3d055281
claimed: "2026-09-11T06:40:34Z"
---

# B1275 — The preview header offers Put this day on the site, which does not put the day on the site
## Why

This one cost a whole test run before it was noticed, which is a fair measure of
how it lands on a person.

The **How it looks** pane — the preview of a day as readers will see it — carries
a button in its header reading **Put this day on the site**. Pressing it:

1. posts to `/api/helper/<user>/proposal` (three times, B1274),
2. **switches the view back to the Chat tab**, and
3. leaves the day exactly as it was: `status: draft`.

What it actually does is open a *proposal card* further down the chat — the card
with the real **Put it on the site** button on it. On a phone that card is below
the fold of a transcript that has just been scrolled, so what the person sees is:
they pressed the button that says the day goes on the site, the preview closed,
and they are back in the conversation. Every signal says done.

It is not done. The day stayed a draft, and the server log for the whole session
carries no publish call at all. It was only caught by reading the file on disk —
`status: draft` — and confirmed by asking the model, which answered *"5 September
is still a draft."*

This is the failure `lib/helper/model.ts` was built to prevent, arriving through
the interface instead of through the model: nothing said anything untrue in
words, and the person was still left believing their day was published when it
was not. AGENTS.md is explicit that publishing is a decision taken in a moment
that must be visible — *"ask, in words, and wait for an answer"* — and a button
labelled with the action, which performs a different action and then navigates
away, is the opposite of that.

Reproduced on fernscout.ch, 390x844, 2026-09-10.

## Work

- The label must name what the press does. If it opens the confirmation, it says
  so; if it publishes, it publishes.
- Do not navigate away from the preview on press. If the press produces a card in
  the chat, the person has to be taken *to the card*, with the card in view —
  which B1253 is also about.
- Whatever is chosen, a person must be able to tell afterwards whether the day is
  on the site. The preview already knows: it renders `DraftNotice` (B1257). After
  a successful publish that banner should be gone, and it is the cheapest possible
  confirmation.

## Acceptance

- Pressing the control in the preview header either publishes the day, or leads
  to a visible confirmation that has not yet published it — and its label says
  which.
- After the day is published, the preview no longer shows the draft banner
  without a reload.
- A day that is still a draft is never left looking published.
