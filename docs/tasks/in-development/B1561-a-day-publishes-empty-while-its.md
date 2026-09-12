---
id: B1561
title: A day publishes empty while its draft_words proposal is still unpressed
type: ISSUE
priority: high
complexity: medium
area: helper
found: "2026-09-12T07:31:30Z"
started: "2026-09-12T07:38:13Z"
session: 47912984-b51b-4d11-b25e-5b026ba593de
claimed: "2026-09-12T07:38:13Z"
---

# B1561 — A day publishes empty while its draft_words proposal is still unpressed

## Why

Found by reading the live helper sessions of journal `severin` from
2026-09-12 (session `893fc9b4…`, WhatsApp → web). At 06:59 the helper
proposed `draft_words` for the owner's notes ("arbeiten, app programmieren,
bolognese kochen"). The press never came — the owner moved on to photos —
and the proposal silently died. Four minutes later `publish_day` was
proposed and pressed, and the day went live with title `2026-09-11` and a
body of literally `…`: no words, and at that moment no photos either.

"A proposal made and never pressed is the clearest failure signal this
product has" (`lib/helper/sessions.ts`), and here it swallowed the whole
point of the day. `publish_day` in `lib/helper/tools/areas/days.ts` already
refuses an already-published day (`agent.tool.alreadyPublished`, B1305) but
happily proposes publishing a day that says nothing at all.

## Work

In `publish_day`'s `propose` (lib/helper/tools/areas/days.ts:338): refuse
the proposal when the day is entirely empty — no words beyond the `…`
placeholder **and** no gallery — with a sentence that says what is missing
and how to fix it (tell me about the day / attach photos). A day with
photos but no words still publishes (photo-only days are legitimate), but
the sentence warns that it carries no words yet.

Not doing: resurrecting the dead `draft_words` proposal, or any thread
memory of unpressed proposals — the refuse-at-publish check is the guard
that would have held here regardless of why the day is empty.

## Acceptance

Asking the helper to publish a day whose content is empty/`…` and whose
gallery is empty yields a refusal sentence, not a publish button. A day
with photos and no words still gets the button, with a warning in the
sentence. Locale keys exist in en/de/hu; `npm run verify` green.
