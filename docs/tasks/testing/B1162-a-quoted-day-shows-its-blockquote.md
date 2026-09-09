---
id: B1162
title: A quoted day shows its blockquote marker, in the one block where quoting happens
type: ISSUE
priority: medium
complexity: low
area: components/HelperAsk.tsx
found: "2026-09-09T19:32:20Z"
merged: "2026-09-09T19:41:25Z"
---

# B1162 — A quoted day shows its blockquote marker, in the one block where quoting happens

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

B1120 taught the model that `> ` means *words that came out of the journal, and
only that* — and the block where a day is actually quoted does not render it.

`components/HelperAsk.tsx:1188` draws a `preview` block's `lines` as raw text
straight into a paragraph. `AnswerText` is wired only into the `say` fallback,
so a line the model wrote as `> Thirteen hours, a bunk with a curtain…` shows
its marker on screen.

The prompt now teaches a mark that leaks in the most likely place it is used,
which is worse than not teaching it: found on the live site the same day.

## Work

Render a `preview` block's lines through `AnswerText` as well.

Check what a preview's lines actually are first, because there are two callers
and they may differ: some previews carry the day's own stored prose (which is
the author's markdown and arguably should render), and some carry lines the
model wrote. If they differ, say which in a comment rather than guessing —
rendering an author's own `>` as a quote is right, and swallowing a character
they typed literally is not.

## Acceptance

Ask the room to show a day whose words the model quotes. No blockquote marker
appears on screen, and a day whose own prose contains a `>` still reads as the
author wrote it.
