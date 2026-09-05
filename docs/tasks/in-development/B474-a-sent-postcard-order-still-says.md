---
id: B474
title: A sent postcard order still says nothing has been printed, and names the day by its slug
type: ISSUE
priority: high
complexity: low
area: postcards, i18n
found: "2026-09-05T18:00:00Z"
started: "2026-09-05T13:38:30Z"
session: 8af79b62-fe04-4cc3-b94b-9609f44a5f9d
claimed: "2026-09-05T13:38:30Z"
---

# B474 — A sent postcard order still says nothing has been printed, and names the day by its slug

## Why

The line under the heading reads:

> **Postkarten, bereit zum Senden**
> Vom sierra-smoke. Es wurde noch nichts gedruckt und nichts abgebucht.

with the banner directly beneath it saying *"Gesendet. Die Karten sind in der
Druckerei."* Two mistakes, and the second one is the page telling the owner
something untrue about their own money.

**`sierra-smoke` is the day's slug.** It is a URL segment, not a name —
`lib/entries.ts` says as much where it derives one. The day has a title, and
that is what a person recognises; the slug is what they see instead.

**The intro is unconditional.** "Nothing has been printed or charged yet" is
written once and rendered whatever state the order is in, so an order that has
been printed and charged says the opposite of what happened directly above the
notice saying it happened. The heading has the same fault: "ready to send" is
the title of a page whose cards are already at the printer.

Two more lines outlive their moment the same way. The language advice —
*"schreib sie selbst auf Deutsch, wenn dir das lieber ist"* — and the
low-resolution warning are both advice about a decision the owner no longer
has. After a send they are noise at best and a suggestion to redo something at
worst.

## Work

- Give the heading and the intro a sent form and a waiting form, in all three
  locales.
- Name the day by its **title**, from `getEntryBySlug(ref, slug)`, falling
  back to the slug only when there is no entry to read. Include the date: a
  postcard is about a day, and "Vom 14. August" is what the owner remembers.
- Show the language mismatch note and the low-resolution warning only while
  the order can still be changed. Both are advice, and advice about a card in
  the post is not advice.

**Not doing:** a general "past orders" view. That is B442.

## Acceptance

- A sent order's page says it was sent, in the heading and the intro, and
  nowhere claims nothing has been printed or charged.
- A waiting order reads exactly as it does now.
- The day appears by its title and date, not `sierra-smoke`.
- Neither the language note nor the resolution warning appears once sent.
