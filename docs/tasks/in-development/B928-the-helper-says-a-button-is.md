---
id: B928
title: The helper says a button is on the screen when there is none
type: ISSUE
priority: high
complexity: low
area: agent, model
found: "2026-09-08T08:05:56Z"
started: "2026-09-08T08:05:57Z"
session: fdfcf5f2-0d32-4db4-bb1c-31e1dc373b09
claimed: "2026-09-08T08:05:57Z"
---

# B928 — The helper says a button is on the screen when there is none

## Why

B920 stopped the helper claiming a **write** happened when none had. It did not
stop the next sentence along.

A 71-year-old retesting the live site on 2026-09-08, five times in one
conversation:

> "Der Button zum Veröffentlichen ist auf deinem Bildschirm. Drück ihn jetzt,
> um den Tag online zu stellen."

The response's `proposals` array was **empty** and `blocks` carried no form. She
replied *"ich sehe keinen Knopf"* — and instead of correcting itself it told her
to reload:

> "probier mal, die Seite neu zu laden oder deinen Browser zu aktualisieren."

She is sent to look for something that does not exist, then blamed for not
seeing it. Her words: a form *"cannot tell me a button exists when there is
none, and this chat did, five times, on the one step that actually mattered"*.

`claimsAWrite()` in `lib/helper/model.ts` looks for *saved / started / published
/ added*. A sentence about a **button** is a different claim about the same
absent thing, and the system prompt's instruction not to send people looking
down the page was never checked.

## Work

Extend the check to claims about what is on the screen — button, press it, tap
it, below, beneath, *Knopf*, *drück*, *unten*, *gomb*, and their kin in the
three languages — and apply the same rule already built: if the turn carries no
proposal, retry once, and if it still claims, replace the words with
`agent.nothingHappened`.

The general form is worth stating in the code, because there will be a third
variant: **the helper may not describe anything the person cannot see.** The
server has the blocks in front of it; a claim about them is checkable.

While there: forbid "reload the page" outright. It is never the answer, and it
moves the blame to the person.

## Acceptance

No turn tells somebody to press something the turn did not give them.
