---
id: B358
title: The invite copy button's accessible name ends in two dangling em-dashes and reports no success
type: ISSUE
priority: low
complexity: low
area: a11y
found: "2026-09-04T19:57:28Z"
started: "2026-09-04T21:05:04Z"
merged: "2026-09-04T21:23:35Z"
---

# B358 — The invite copy button's accessible name ends in two dangling em-dashes and reports no success

## Why

On `/<user>/contacts`, the control that copies an invitation link renders:

```html
<button aria-label="Copy the A link for someone to write — —">
  <span aria-hidden="true">Copy link</span>
  <span class="sr-only" role="status"></span>
</button>
```

Two faults, both only reachable with a screen reader:

- The accessible name ends in two dangling em-dashes. It is built by joining
  the link's kind, its label and its note, and this link has neither of the
  last two, so the separators are announced with nothing between them: "Copy
  the A link for someone to write, dash, dash." The visible text is "Copy link"
  and is fine.
- The `role="status"` span stays empty after a successful copy. A sighted user
  has the clipboard; a screen-reader user is told nothing happened.

Observed 2026-09-04 on fernscout.ch. The copy itself works — it returned the
full invite URL.

B199 is the same family on the agent-handover control.

## Work

Drop the separators for the parts that are absent, and put a word in the status
span on success.

## Acceptance

An invite with no label has an accessible name with no trailing punctuation,
and copying announces something.
