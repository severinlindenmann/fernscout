---
id: B796
title: A refusal and the model's answer are both silent to a screen reader
type: ISSUE
priority: medium
complexity: low
area: agent, a11y
found: "2026-09-07T14:55:06Z"
started: "2026-09-07T15:09:33Z"
merged: "2026-09-07T15:23:13Z"
---

# B796 — A refusal and the model's answer are both silent to a screen reader

## Why

Three things a person needs to hear are markup a screen reader never announces:

- **Refusals.** `{error && <p className="mt-4 …">{error}</p>}`
  (`AgentWizard.tsx:719-723`) — no `role="alert"`, no live region. A bad trip, a
  full disk, a dead network: all silent. `SignupWizard.tsx:204` gets this right
  with `<p role="alert">`, so the wizard that matters most dropped the role the
  signup flow kept.
- **The model's answers.** The suggested write-up (`:989-1032`) and the photo
  captions (`:1075-1106`) arrive after an async call and are plain markup —
  exactly the moment an announcement matters most, because the person is
  waiting for something they paid a credit for.
- **The step counter.** `agent.stepOf` (`:715-717`) is a plain `<p>`; advancing
  from step one to step three says nothing.

Separately, three structurally important sub-headings are bold `<p>` rather
than headings, so heading navigation skips them entirely: `agent.missingTitle`
(`:755`), `agent.helperSuggestionTitle` (`:991`), `agent.captionsTitle`
(`:1077`).

Found by a blind tester on the live site, 2026-09-07.

## Work

`role="alert"` on the wizard's error, matching `SignupWizard`. A polite live
region for the model's answer and for the captions. Real `<h3>`s for the three
pseudo-headings. Decide whether the step counter announces — it may be better
carried by the focus move in B795 than by a second live region competing with
it.

## Acceptance

A refusal is heard. The model's answer is heard when it arrives. Heading
navigation reaches the missing-data questions, the suggestion and the captions.
