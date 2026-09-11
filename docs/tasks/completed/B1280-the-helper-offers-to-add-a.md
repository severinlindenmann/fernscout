---
id: B1280
title: The helper offers to add a postcard recipient, then refuses and names a settings page that does not exist
type: ISSUE
priority: high
complexity: low
area: helper, postcards
found: "2026-09-10T10:36:49Z"
started: "2026-09-11T08:26:07Z"
merged: "2026-09-11T09:55:07Z"
---

# B1280 — The helper offers to add a postcard recipient, then refuses and names a settings page that does not exist

## Why

Two turns in the helper room, on a journal with no contacts:

> **You:** Can you make a postcard from the 5 September day?
>
> You have no recipients on file yet. To send a postcard, you need to add a
> name, town and country for each person. **Would you like to add someone?**
>
> **You:** Yes please. Add Anna Muster, Bern, Switzerland.
>
> **I can't add recipients from here** — that's done on your journal's own
> settings page. Once you've added Anna there, come back and I can propose the
> postcard.

Three things wrong, in increasing order of seriousness.

**It offered and then refused.** The question "Would you like to add someone?"
has one answer the person can give and the model cannot honour. A capability the
model does not have should not be offered.

**It named a page that does not exist.** There is no "settings page" on a
journal. The page that holds contacts is `/&lt;user&gt;/contacts`, titled
**Readers**, and it is reached from the menu as "Your access". "Your journal's
own settings page" is a place the person will now go looking for.

**It invited an address into the conversation, and got one.** *Anna Muster,
Bern, Switzerland* is now in the transcript — and conversations are stored, and
the room says so ("Your conversations are saved… We read them to make Fernscout
better"). AGENTS.md is explicit that this must not happen:

> Addresses never reach an agent. `GET …/postcards/recipients` answers with a
> name, a town and a country, and cards are addressed by `contactId` — **so a
> card can only ever go to somebody who asked this journal for one, and never to
> an address that arrived in a conversation.**

The mechanism held — nothing was written — but the prompt walked the person
straight into typing one, which is the behaviour that rule exists to prevent. A
person who answers with a full street address next time will have put it in a
stored transcript for nothing.

## Work

- The room should answer the no-recipients case with what is actually true and
  possible: nobody has asked this journal for post yet, here is how somebody
  does (the invitation link on `/&lt;user&gt;/contacts`), and no address is
  typed anywhere.
- Never offer to add a recipient. AGENTS.md notes that a tool which lets the
  model assert something new may need a guard in `lib/helper/model.ts`; the
  converse case belongs there too — a turn that *promises* an action no tool
  can perform is a claim about the journal that is false.
- Link to the right page by its real name.

## Acceptance

- Asking for a postcard with no contacts produces no offer to add one and no
  request for a name, town or country.
- The page named in the answer exists and is called what the answer calls it.
