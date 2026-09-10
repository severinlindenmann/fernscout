---
id: B1296
title: The room names trips by their id and dates in ISO, in a conversation that otherwise speaks plainly
type: ISSUE
priority: low
complexity: low
area: helper
found: "2026-09-10T11:04:54Z"
---

# B1296 — The room names trips by their id and dates in ISO, in a conversation that otherwise speaks plainly

## Why

The helper room is written for somebody with no agent, and it mostly speaks like
it — *"The trip runs from 5–8 September"*, *"A proposal for 5 September is on
your screen"*. Three places break that, all on the same screens:

**Trip ids.** After adding a traveller:

> A proposal is on your screen to add you as a traveller on
> **`bern-weekend-2026`**.

The trip is called *Bern Weekend*. `bern-weekend-2026` is its directory name.

**ISO dates in the cards.** The trips card renders

> Bern Weekend · **2026-09-05 – 2026-09-08**

one line above the model writing *"The trip runs from 5–8 September"* in the
same room. Two registers, same fact, and the machine one is in the card the eye
lands on.

The same shape appears on the write-up card ("The title and the words of
**2026-09-05**"), the attach card, and the publish card.

**Third-person labels on cards about the reader.** The traveller card, adding the
owner to their own trip, has fields labelled **Their name** and **Their email**,
under a sentence that says *"Mo joins the byline"*, after the model said *"add
**you** as a traveller"*. B1277 covers the same fault in the `agent.tool.*`
prose; this is the field labels beside it.

None of these is wrong, and each one is small. Together they are what makes the
room read as an admin console with a chat on top, for the person it was
specifically built to spare that.

## Work

- Render a trip by its title wherever a person reads it; keep the id for the URL
  and the API.
- Render dates in the card the way the prose renders them.
- Give the traveller card second-person labels when the subject is the signed-in
  person, or neutral ones ("Name", "Email address") when it may not be.

## Acceptance

- No trip id and no ISO date appears in the helper room's prose or cards.
- The traveller card does not call the reader "they" when it has just called
  them "you".
