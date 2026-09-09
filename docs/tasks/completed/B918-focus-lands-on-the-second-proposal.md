---
id: B918
title: Focus lands on the second proposal and strands the first
type: ISSUE
priority: medium
complexity: low
area: agent, a11y
found: "2026-09-08T07:07:05Z"
started: "2026-09-08T07:07:46Z"
merged: "2026-09-08T07:26:27Z"
completed: "2026-09-09T16:47:28Z"
---

# B918 — Focus lands on the second proposal and strands the first

## Why

`components/HelperAsk.tsx`:

```jsx
focusRef={index === turns.length - 1 && isProposal(block) ? proposal : undefined}
```

Every proposal in the last turn gets **the same ref object**. React assigns it
in DOM order, so `proposal.current` ends up pointing at whichever mounted last.

A turn routinely carries two — `start_day` then `draft_words` is the ordinary
chain — so focus lands on the **second**, and the **first**, which logically has
to be pressed first, sits *before* the focus point in reading order. Tabbing
forward never reaches it.

Found by a blind tester on the live site, 2026-09-08.

## Work

A keyed ref per proposal, or simply focus the **first** proposal in the turn —
it is the one that has to be acted on first, and "first" is a rule that does not
need a data structure.

## Acceptance

A turn with two proposals lands focus on the one that must be pressed first.
