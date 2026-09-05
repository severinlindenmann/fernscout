---
id: B452
title: The preview page cannot correct a word, and says nothing about language
type: FEATURE
priority: medium
complexity: low
area: postcards, preview page
found: "2026-09-05T15:10:10Z"
---

# B452 — The preview page cannot correct a word, and says nothing about language

## Why

Two things the owner asked for after using the page for the first time.

**A typo means starting over.** B434 made the preview deliberately
confirm-only, on the reasoning that editing lives with the agent. That is right
for a photograph and a recipient list and wrong for the words: seeing the
message laid out on the card is exactly the moment a wrong word becomes
obvious, and the only remedy today is to abandon the order and make another.
The signature is worse — it comes from `config.json` and there is no way to
change it for one card at all.

**Nothing says what language the card is in, or what language its reader
prefers.** A journal writes in three (`example` has en, de, hu) and its
contacts each carry a `locale`. Today the owner can send an English card to
somebody the journal mails in German and find out never, because a postcard has
no reply.

## Work

- **Editable message and signature**, on the preview page, in a form that
  `POST`s to `/<user>/postcards/<id>/message` — cookie-only and bearer-refused,
  the same guard as the send route beside it, and for the same reason. Refuses
  unless the order is still `draft`.
  Photo and recipients stay fixed; changing those is a new order.
- **The card's own language**, stored on the order as `payload.locale`,
  defaulting to the journal's default locale, shown and changeable beside the
  text. Not detected from the words — nothing here should guess a language and
  then assert it.
- **Each recipient's language**, from their contact record, on their row. This
  is the one that earns its place: it is how the owner notices the mismatch.
- Flag it when they differ — quietly, a note and not a refusal. Somebody
  writing to a German reader in English is often doing it on purpose.

**Not doing:** translating anything. The message is the owner's words in the
language they chose to write them.

## Acceptance

- A typo is fixable on the preview page without a new order, and the corrected
  words are what the PDF carries.
- An order whose language differs from a recipient's says so before the button.
- `POST …/message` refuses a request carrying `Authorization`, and refuses an
  order that is not `draft` — with tests for both.
