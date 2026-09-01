---
id: B14
title: Postcards cannot address themselves from the contacts that hold the addresses
type: FEATURE
priority: medium
complexity: medium
area: postcards, contacts
found: "2026-09-01"
---

# B14 — Postcards cannot address themselves from the contacts

## Why

Ran end to end, on the demo journal:

```
npm run postcard -- --user example \
  --photo content/example/trips/alps-2024/media/over-the-susten/01.jpg \
  --message "Testing the pipeline." --to recipients.json
```

It works. Four files land in `content/example/postcards/` — the card, the
front and back as separate pages for Stannp, and the Stannp request — with an
honest DPI warning about the web-sized photo. The geometry, the PDF writing
and the request shape are all covered by `test/postcard.test.ts`.

What it cannot do is know who to send to. `--to` is a JSON file of postal
addresses the author types out by hand, and the docblock at
`scripts/postcard.ts:12` says why:

> Recipients are a JSON array of postal addresses. Once the contacts work
> lands (W10) this reads from the contacts table instead, and the file becomes
> the fallback for people who would rather keep a file.

The contacts work landed. `lib/contacts/crypto.ts` stores each contact's
postal address encrypted at rest — `line1`, `line2`, `postcode`, `city`,
`country` — with `isPostable()` at `lib/contacts/crypto.ts:119` answering
exactly the question this script needs: is there enough here to put on an
envelope. `/<user>/join` collects it and `/<user>/contacts` administers it.
Nothing joins the two halves up, so the one thing the feature is for —
"postcards to everyone" — is still a hand-typed file.

Three smaller things the run turned up, worth fixing in the same pass because
they are all in these two files:

- The usage docblock at `scripts/postcard.ts:2–6` omits `--user`, which is
  required. The error message printed on failure has it; the comment above it
  does not.
- `availableProviders()` in `lib/postcard/providers.ts:106` says the dry-run
  backend "writes print-ready files to `./out/postcards`". It writes to
  `content/<user>/postcards`.
- `swisspost` is in `ProviderName` and has been investigated and rejected in
  writing (`swissPostStatus()`, `lib/postcard/providers.ts:75`). That is a
  decision, not a gap — leave it alone, and do not let a "finish the
  providers" reading of this task reopen it.

## Work

1. Read recipients from the contacts table for `--user`, filtered by
   `isPostable()`. Keep `--to` as the override for anyone who would rather
   keep a file — the docblock already promises that shape.
2. Selection has to be explicit. Sending to every postable contact by default
   is the wrong default for a command that costs money per card; require
   either a named selection or an explicit "all", and print the list with a
   count before rendering anything.
3. Addresses are decrypted only in memory for the render. Nothing decrypted
   goes into a log line, and the rendered PDFs already land under a gitignored
   `content/*/postcards/`.
4. Fix the three drift items above.

Not doing: sending. No provider is called, and B07 is the gate that must exist
before one is.

## Acceptance

- `npm run postcard -- --user example --photo … --message …` with no `--to`
  renders one card per postable contact, and says how many before it starts.
- A contact with a partial address is skipped, named, and does not produce a
  card with a blank line on it.
- `--to file.json` still works unchanged.
- No decrypted address appears in stdout beyond the recipient name already
  printed per card.
- The dry-run note and the script's usage block match what the code does.
