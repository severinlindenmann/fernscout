---
id: B804
title: The bring-your-own-agent panel reads as the next step to somebody who has no agent
type: ISSUE
priority: high
complexity: low
area: agent, ui
found: "2026-09-07T15:16:03Z"
started: "2026-09-07T16:22:33Z"
merged: "2026-09-07T16:55:20Z"
completed: "2026-09-09T16:47:36Z"
---

# B804 — The bring-your-own-agent panel reads as the next step to somebody who has no agent

## Why

B786 worked: a 71-year-old retesting the live site on 2026-09-07 could tell
which of "Ja, ich melde mich an" and "Nein, ich fange eins an" was hers, and
said so. The screen she stopped at last time no longer stops her.

She stopped one screen later instead. Beneath the signup form sits **"Gib das
deinem Agenten"** with a paragraph of English to copy, and she read it as the
next instruction:

> "I do not have an agent. Nobody told me on this screen what one is or where I
> get one. My son's message said 'das ist ganz einfach' — this screen is the
> first place that isn't."

The panel is correct and must stay — bring-your-own-agent is the promise this
project is built on, and B681 deliberately put it on the page whether the
helper is on or off. What is wrong is that it is *adjacent and unexplained*, so
somebody who has never heard the word "Agent" in this sense reads a block of
English as their next step.

Note what she was not confused by: the word "Entwurf" was clear, and the new
publish sentence was, in her words, the best sentence in the test. The problem
is specific to this panel.

## Work

Frame it for the person who is not its audience, in one line before it, in
plain German: something like *"Benutzt du schon ein Programm wie ChatGPT? Dann
kannst du ihm das hier geben — sonst brauchst du das nicht."* The last clause
is the important half: permission to ignore it.

Consider collapsing it behind that line on the signed-out door, the way the
intro now hides behind "warum?". Do not remove it and do not move it off the
page.

## Acceptance

Somebody who has never used an agent reads one sentence that tells them this
part is not for them, and carries on.
