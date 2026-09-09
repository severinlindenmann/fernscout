---
id: B1056
title: A helper answer can only be drawn in the web room, because Block has exactly one renderer
type: FEATURE
priority: high
complexity: high
area: helper, blocks, channels, whatsapp
found: "2026-09-09T07:11:41Z"
---

# B1056 — A helper answer can only be drawn in the web room, because Block has exactly one renderer

## Why

`lib/helper/blocks.ts:23` names seven shapes — `say`, `choose`, `form`,
`preview`, `files`, `confirm`, `link` — and `BlockView` in
`components/HelperAsk.tsx:966` is the only thing that has ever drawn one. The
vocabulary was designed against native HTML controls on purpose: a
`ProposalField` becomes `<input type="date">`, a `<textarea>` or a `<select>`
and nothing bespoke.

WhatsApp's vocabulary is a different and much smaller thing: a body of text,
**at most three reply buttons of twenty characters each**, or **one list of at
most ten rows**, plus a location request and a Flow (a multi-screen form
opened inside WhatsApp, which needs its own JSON definition and Meta review).
There is no editable free-text field attached to a message, and no way to show
a form and a photograph and three buttons at once.

So the mapping is not one-to-one and pretending otherwise is how a channel
ships that can say *"press the button below"* into a medium with no button —
which is precisely the sentence `claimsAButton` in `lib/helper/model.ts:795`
exists to catch. **The honesty guards are written against a screen the model
cannot see, and a second channel makes them wrong in a new way.** That is the
part of this ticket that is not cosmetic.

The shapes, honestly assessed:

| shape | WhatsApp |
| --- | --- |
| `say` | text. Fine. |
| `link` | text with a URL. Fine, and it is the escape hatch for everything below. |
| `choose` | ≤3 options → reply buttons; 4–10 → a list; more → text with a link to `/agent` |
| `confirm` | reply buttons: the accept sentence and a "no". Fine, and the closed-question fields are more buttons or more turns. |
| `preview` | text, truncated, plus a link. A day's words are longer than a message should be. |
| `files` | a list, or text. |
| `form` | **has no WhatsApp shape.** Several fields, editable, some of them dates. Either a Flow, or a series of turns, or a link to the web room. |

## Work

- Move rendering behind a seam: `Block[]` in, a channel's own payload out. The
  web room's renderer becomes one implementation and does not change.
- Decide `form`'s fate, and say why in the file. The three candidates are a
  WhatsApp Flow (best experience, Meta review, a second definition of every
  form), a turn-per-field conversation (no review, slow, and the model already
  knows how to ask), or a link into `/agent` (free, and admits the channel is
  not complete). A person picks; see the question book.
- **Revisit the guards in `lib/helper/model.ts` for a channel with no screen.**
  `ON_SCREEN`/`RELOAD` in `claimsAButton`, and the fallback sentences in
  `PLAINLY`, both assume a page. A guard that fires on an honest turn is a bug
  (AGENTS.md), and so is one that misses.
- Keep the seam boring. One function per channel, chosen by the caller. Not a
  registry, not a plugin interface — `importers/` is the precedent for adding
  a second one later by dropping in a file.

## Acceptance

The same `Block[]` renders in the web room unchanged and as a WhatsApp payload
that respects three buttons, ten rows and the twenty-character button cap —
proved by a test over the whole shape vocabulary, not a sample.
