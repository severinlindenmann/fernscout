---
id: B1236
title: A proposal turn on WhatsApp repeats itself and dumps raw lists into one message
type: ISSUE
priority: medium
complexity: low
area: whatsapp, helper
found: "2026-09-10T06:06:24Z"
merged: "2026-09-10T06:32:59Z"
completed: "2026-09-10T15:12:34Z"
---

# B1236 — A proposal turn on WhatsApp repeats itself and dumps raw lists into one message

## Why

`lib/whatsapp/render.ts`'s `renderForWhatsapp` folds every block a turn
drew into one message by concatenating their text, in order. A write
proposal from `proposalFor` (`lib/helper/tools/run.ts`) draws a `preview`
block and a `confirm` block back to back, and both carry the **same**
`text` — `made.sentence` — because `preview` is meant for a screen with
room for a heading and a table underneath it, and `confirm` was never
meant to follow one in the same bubble. Add a preceding `files` block
(from an `inbox` read the model ran first) and the live evidence follows
exactly: a raw inbox dump ("Im Eingang wartend • whatsapp-photo.jpg —
photograph, 312 KB …"), then the proposal sentence (from `preview`), then
that block's own itemised list flattened with " — " ("2026-09-10 —
2026-09-10 — whatsapp-photo.jpg — whatsapp-photo.jpg"), then the same
sentence a third time (from `confirm`), then the two buttons.

## Work

`renderForWhatsapp` now tracks each pushed line's originating shape
alongside its text (`entries: { shape, text }[]`, replacing the plain
`string[]`). A `confirm` block builds its message body through a new
`confirmBody(finalText)` helper rather than `[...lines, block.text]`: it
drops every entry whose shape is `preview` or `files` — the raw dumps that
exist to back exactly this confirm, on a screen with room for them, not to
be flattened into a chat bubble a second time — and drops any remaining
entry whose text is identical to the confirm's own sentence, then appends
that sentence once. What is left (the model's own `say` prose, a `link` or
an earlier `choose`) stays untouched.

Not touched: the `choose` branches (buttons/list) — they were not what the
live evidence showed wrong, a `preview`/`files` block rarely precedes a
`choose`, and narrowing the diff to the reported bug is the smaller and
safer change. The terminal `{ kind: "text" }` fallback (no interactive
block at all — an `inbox` listing on its own, say) is also unchanged: it
still folds every entry's text in, because in that case there is no
`confirm` sentence to be the duplicate of and the raw list is the whole
answer.

## Acceptance

`npx vitest run test/whatsapp-render.test.ts` — two new cases under
`describe("confirm")`: one reproduces the live shape (`files` → `preview`
→ `confirm`, all naming the same sentence) and asserts the sentence
appears exactly once in the outbound body and no "—"-joined raw file line
survives; the other asserts a `say` block's prose still precedes the
sentence when nothing needs dropping.
