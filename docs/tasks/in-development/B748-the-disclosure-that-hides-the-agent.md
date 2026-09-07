---
id: B748
title: The disclosure that hides the agent instructions looks like a link, so nothing says it opens
type: ISSUE
priority: low
complexity: low
area: landing, a11y
found: "2026-09-07T14:55:00Z"
started: "2026-09-07T12:53:40Z"
session: ccdd5120-0eb0-4abf-b76e-a6fd8e5005d8
claimed: "2026-09-07T12:53:40Z"
---

# B748 — The disclosure that hides the agent instructions looks like a link, so nothing says it opens

## Why

B732 put the bring-your-own-agent material behind a `<details>`, which was
right: the audience it was kept for pays one tap and everybody else gets a
shorter page. But the `<summary>` is styled as underlined text and the native
marker is suppressed, so on the rendered page it is indistinguishable from the
"New here? Read the guide" link a few hundred pixels above it — and those two
do different things. One navigates, one expands in place.

A reader who takes it for a link has no reason to press it, which is the whole
failure: the material is not gone, it is behind an affordance that does not
announce itself. Seen in the 390px screenshot taken while verifying B732.

The keyboard and screen-reader story is already correct — `<details>` carries
`aria-expanded` itself, which is most of why it was chosen over a `useState`
panel. This is only what a sighted reader can tell by looking.

## Work

- A chevron in the summary that rotates on `[open]`, or an equivalent visual
  that distinguishes expanding from navigating. Pure CSS off the `open`
  attribute; no JavaScript and no state.
- Drop the underline, or keep it and add the marker — but the summary must not
  read as a plain hyperlink.
- Respect `prefers-reduced-motion` for the rotation.

Not doing: changing what the disclosure contains, or when it is shown. B732
decided both.

## Acceptance

- On `/` with the helper on, the summary is visually distinguishable from the
  links around it before it is pressed.
- It still opens with a keyboard alone, and still reports its state to a
  screen reader.
- Checked at 390px.
