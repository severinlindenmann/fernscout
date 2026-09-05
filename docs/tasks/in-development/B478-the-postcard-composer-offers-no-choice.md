---
id: B478
title: The postcard composer offers no choice of day or language for the prefilled text
type: FEATURE
priority: medium
complexity: low
area: postcards, UI
found: "2026-09-05T13:57:39Z"
started: "2026-09-05T13:58:00Z"
session: c1b5210b-0188-4c7a-8840-654a2db4319f
claimed: "2026-09-05T13:58:00Z"
---

# B478 — The postcard composer offers no choice of day or language for the prefilled text

## Why

`components/PostcardSheet.tsx` prefills the message box from exactly one
source: the markdown twin of the day the photograph belongs to, in the
language the journal is written in. A journal that keeps `de`, `en` and `hu`
translations of every day (`translations:` in the entry frontmatter, read by
`lib/entries.ts:parseTranslations`) has that text sitting on disk, and the
composer cannot reach it — the owner writing a card to somebody in Budapest
retypes what the day already says in Hungarian.

The day is fixed too. A card carries one photograph but its words are often a
week's worth, and the only remedy is to close the sheet, find another day's
picture, and start again.

The order already understands both: `POST /api/v1/<user>/postcards` takes a
`locale` (B452) and the sheet never sends one, so a card composed in German is
recorded as being in the journal's default language and the preview page's
"reads in another language" warning compares against the wrong thing.

## Work

- `lib/postcard/opening.ts` — `openingOf` moved out of the client component so
  the server can use it too. `PostcardSheet` re-exports nothing; the test
  imports from the new module.
- `GET /api/v1/<user>/postcards/texts?trip=<id>` — owner only, same shape of
  guard as `…/postcards/recipients`. Answers with the trip's days (drafts
  included, test content excluded) and, per day, the opening in every locale
  the journal offers: the entry's own `content` under the written locale,
  `translations[<locale>].content` for the rest.
- `PostcardSheet` — a day select and a language select above the box, each
  rendered only when there is more than one thing to choose. Changing either
  replaces the message; it is a prefill, and asking for another day's words is
  an explicit request for them. Replaces the `/{user}/day/<slug>.md` fetch.
- The chosen `locale` goes in the `POST …/postcards` body. `day` stays the
  photograph's own day — the card is from that picture, and the text picker is
  a convenience.

Not doing: a day/language switcher on the preview page. That page already
edits the words and sets the language (B452); re-deriving day text there means
a second copy of this machinery for a form that has no JavaScript.

## Acceptance

- With a trip whose days carry `translations:`, opening the composer and
  choosing `Magyar` puts the Hungarian opening in the box; choosing another
  day puts that day's.
- The created order's `payload.locale` is the language that was chosen.
- `GET /api/v1/<user>/postcards/texts` answers 403 to a bearer token scoped to
  a trip and to a guest cookie, 404 when postcards or contacts are off.
- `npm run verify` green.
