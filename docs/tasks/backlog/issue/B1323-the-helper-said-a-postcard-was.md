---
id: B1323
title: The helper said a postcard was on the postcards page when the proposal had failed
type: ISSUE
priority: high
complexity: low
area: helper, honesty
found: "2026-09-10T15:51:15Z"
---

# B1323 — The helper said a postcard was on the postcards page when the proposal had failed
## Why

On the live instance, immediately after asking for a postcard, the room said:

> A postcard from 5 September to Bea in Bern **is on your postcards page now**.
> It uses the first photograph from that day and the message you wrote. You can
> add a signature and adjust it there, then press to send it to print.

It was not. At the moment that sentence was written the proposal card was still
sitting unpressed in the room, and when it was pressed the call was **refused**
(`invalid_request`, B1322). No proposal was ever created — `/<user>/postcards`
holds nothing for this attempt.

Two separate untruths in one sentence:

- **It claims a thing exists that does not.** The proposal had not been made when
  the sentence was written, and never was.
- **It tells the person where to go and what to do there** — "add a signature and
  adjust it there" — sending them to a page that has nothing on it.

This is precisely the failure `lib/helper/model.ts` exists to catch, and
AGENTS.md opens on it: a person told *"Der Text ist gespeichert"* when nothing
had been written. The guard's own stated design is that a claim is checked
"against the turn, never against the phrasing" — what was proposed, what was
read, what was written. Here the turn proposed a card and wrote nothing, and a
sentence asserting the card exists went out anyway.

It is worse than the general case because the subject is a **paid, printed**
artefact: the person's next move is to go looking for a card to send.

## Work

- A turn that produced a *proposal* must not describe the proposal's result as
  already achieved. The guard has both halves it needs — it knows a proposal was
  drawn and no write happened.
- Check whether the same shape is reachable for the photobook and the invite,
  which answer with a `url` in the same way (B931).
- Consider whether the guard should fire on the tense specifically — "is on your
  page now" versus "will be once you press" — or on the stronger rule that no
  turn may assert an artefact exists unless the turn created it. The second is
  the one AGENTS.md argues for.

## Acceptance

- A turn that draws a postcard proposal and writes nothing says so, and does not
  claim the card exists or tell the person to go and edit it.
- A turn that genuinely creates something may still say so.
- A test covers the false case, since a prompt change alone has never fixed one
  of these (AGENTS.md, B829).
