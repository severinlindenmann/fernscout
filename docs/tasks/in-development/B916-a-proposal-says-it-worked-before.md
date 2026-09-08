---
id: B916
title: A proposal says it worked before it has worked
type: ISSUE
priority: high
complexity: low
area: agent, ui
found: "2026-09-08T07:07:04Z"
started: "2026-09-08T07:07:45Z"
session: fdfcf5f2-0d32-4db4-bb1c-31e1dc373b09
claimed: "2026-09-08T07:07:45Z"
---

# B916 — A proposal says it worked before it has worked

## Why

`components/HelperAsk.tsx`, `ProposalView`, ~line 845:

```jsx
onClick={() => {
  setSettled("accepted");        // fires immediately
  void onAccept(proposal, values);  // the fetch has not resolved
}}
```

The card swaps **irreversibly** to `proposal.done` — *"The day is started. It is
a draft, so nobody but you can read it."* — the instant the button is pressed.
Then the write happens. If it fails, the only trace is a separate
`<p role="status">That did not work: incomplete_day</p>` appended below the log,
the busy indicator and the input box. `settled` is never rolled back.

This is the failure this whole product is built against, in the newest surface.
AGENTS.md: **"it was accepted" must not be a different claim from "it is
there".** Here the software says a day was started when no day exists.

A blind tester found it, and named why it is worse for them than a blocker:

> "A screen-reader user who has just heard the proposal announce success has no
> reason to keep listening past it."

It also **regresses B796 in spirit**: that ticket was about refusals being
silent. A refusal that arrives *after* a spoken success claim is worse than
silence — the person has been told the wrong thing happened.

Found live on 2026-09-08, with B917 as the failure that exposed it.

## Work

Do not settle until the write resolves. `BusyButton` already has a `busy` prop
for the state in between.

On failure: keep the fields visible, re-enable the button, and put the error
**inside the proposal card, beside the fields it belongs to**, with focus moved
to it. Not appended below the log where it is disconnected from the action that
produced it.

## Acceptance

A proposal says a thing was done only after it was done, and a failed press
leaves a card a person can correct and press again.
