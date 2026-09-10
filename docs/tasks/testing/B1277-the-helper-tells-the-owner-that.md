---
id: B1277
title: The helper tells the owner that a preview is waiting on their postcards page, in the third person
type: ISSUE
priority: medium
complexity: low
area: helper, i18n
found: "2026-09-10T10:26:45Z"
merged: "2026-09-10T15:39:42Z"
---

# B1277 — The helper tells the owner that a preview is waiting on their postcards page, in the third person
## Why

In the helper room, to the owner of the journal, in English:

> A link to **their** photobook page is waiting. Nothing has been built or charged.

and

> A preview is waiting on **their** postcards page, with the price and **their**
> balance. Nothing has been printed.

and, on the postcards proposal card itself:

> **Their** balance is {balance} credits.

The room is a conversation with the owner. These sentences are written about
them, to somebody else. They read as the model reporting to a third party —
which is exactly what they were written as: `agent.tool.*` strings describing a
tool's effect, phrased for an agent working *on behalf of* an owner, then
rendered into a room where the owner is the only reader.

Keys, from `site/locales/en.json`:

| key | line |
| --- | --- |
| `agent.tool.photobookDone` | 1877 |
| `agent.tool.proposePostcardsDone` | 1873 |
| `agent.tool.proposePostcards` | 1870 |

German has the same problem and carries it further: *"Ein Link zu **ihrer**
Fotobuchseite wartet"*, *"Auf **ihrer** Postkartenseite"*, *"Gedruckt wird erst,
wenn **sie** drücken"* — third person, lowercase, so not even the polite *Sie*.

**Hungarian is not wrong** and should be left alone: Hungarian's polite address
(*Ön*) takes third-person verb and possessive forms, so *"A képeslapoldalán…
az egyenlegével"* reads as ordinary formal address to the reader.

This is the same class as B1250 — prose written for the API surfacing in the
room built for people who have no agent.

## Work

- Rewrite the English and German strings in the second person. Check the rest of
  the `agent.tool.*` block for the same shape while you are in there; these three
  were found by reading one screen.
- Leave Hungarian as it is unless a Hungarian speaker says otherwise.

## Acceptance

- No string rendered in the helper room refers to the reader as "they" or
  "their" in English, or "ihr"/"sie" in German.
