---
id: B781
title: The consent panels are a wall of text at the moment somebody wants to press a button
type: ISSUE
priority: high
complexity: low
area: agent, ui, i18n
found: "2026-09-07T14:24:46Z"
started: "2026-09-07T14:46:59Z"
merged: "2026-09-07T15:04:26Z"
completed: "2026-09-09T16:46:29Z"
---

# B781 — The consent panels are a wall of text at the moment somebody wants to press a button

## Why

The speech consent panel is **116 words**. The photograph step carries a
28-word paragraph about what the camera recorded. The front door's intro is 31
words above a button.

A 19-year-old tester tapped "Yes, send my voice" without reading past the first
five words, and said so. A 71-year-old tester read the same kind of paragraph
three times and called her son. Both failures are the same failure: policy
prose is doing its work on a screen whose job is a button.

The content of these panels is right, and B684 was right to insist a person is
told what leaves the instance. Being right at 116 words on a phone means nobody
reads it, which is a worse outcome than a short sentence somebody does read.

## Work

One line at the point of decision, the rest behind a "warum?" that expands:

> Schickt deine Stimme an einen Diktierdienst, der sie abtippt. Sie wird nicht
> gespeichert. [warum?]

The expansion keeps every promise the long version makes — what is sent, what
is never sent, that it is not kept, that it is not used for training, and the
provider's name. **The provider is named in the expansion, not dropped**: a
71-year-old reads an unfamiliar company name as a phishing warning, and the
answer to that is order, not deletion.

Same treatment for the photograph paragraph and the door's intro.

## Acceptance

No consent panel or step description is longer than about 25 words before an
expansion. Everything currently promised is still reachable in one tap.
