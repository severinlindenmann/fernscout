---
name: send-postcards
description: Render print-ready postcards from a trip photo and a message, one per recipient, with the provider request built but not sent. Use when the user says "send a postcard", "postcards to everyone", "mail a card from here", or asks what it would take to post real cards from the road.
---

# Send postcards

```bash
npm run postcard -- --user <username> \
  --photo <file.jpg> \
  --message "..." \
  --to <recipients.json> \
  --from "Us"
```

The default backend is `dry-run`: it writes print-ready PDFs to
`content/<username>/postcards/` and calls nobody. That is the whole pipeline
minus the account — see `docs/providers/postcards.md`.

Cards carry somebody's home address, so they are written under the user who
sent them and are gitignored there. Do not move them out of that folder, do not
paste an address into a commit message, and do not read a recipient list back
into a chat that other people can see.

## Steps

### 1. Pick the photograph — the original, not a web copy

A6 landscape at 300 DPI with bleed needs **1819 × 1312 px**. Anything smaller
warns and prints soft. `content/<user>/trips/<trip>/media/…` holds *derivatives*
capped at 2000 px on the long edge, which is just enough; the camera original
(or `MEDIA_ORIGINALS_DIR`, if it is set) is better.

### 2. Build the recipient list

A JSON array. Every address needs `name`, `line1`, `postcode` and `city`;
`line2` and `country` are optional.

```json
[
  {
    "name": "Alex Reader",
    "line1": "1 Example Street",
    "postcode": "8000",
    "city": "Zurich",
    "country": "CH"
  }
]
```

A missing field fails the run by index and by field name rather than posting a
card into a void. Once the contacts capability is on, this file becomes the
fallback for people who would rather keep a file.

### 3. Write the message

It is a postcard. The renderer reports `message-truncated` with the number of
lines that fit rather than silently cutting — but a card that fills every
millimetre reads like a form letter. Keep it to what would fit if you were
writing it by hand.

Write it **in the author's voice and language**, from what they told you. Do
not invent the weather.

### 4. Render

```bash
npm run postcard -- --user <user> --photo <file> --message "..." --to <file> --from "..."
```

Per recipient, in `content/<user>/postcards/`:

| File | For |
| --- | --- |
| `<name>.pdf` | Two pages, front and back — the card |
| `<name>-front.pdf` | Front only — Stannp takes the sides separately |
| `<name>-back.pdf` | Back only |
| `<name>-stannp-request.json` | The request that *would* be sent |

`--guides` adds trim guides. For proofing only — never send a file with them.

The back follows postal convention rather than taste: message left of a divider
at 72 mm, address block at the lower right where sorting machines read it,
stamp area upper right. Getting that wrong does not look wrong; it just gets the
card delivered late.

### 5. Actually posting them

```bash
npm run postcard -- --providers
```

- **`stannp`** — the request builder is written and tested. Needs
  `STANNP_API_KEY` and a funded account. This is the one to use.
- **`swisspost`** — no self-serve API. The community client is unmaintained
  since 2023, predates mandatory SwissID 2FA, and the free allowance of about
  one card a week does not fit a list.

Any backend other than `dry-run` refuses to run without its credentials. If the
author asks you to post the cards, tell them exactly what is missing — do not
imply anything was sent.

## What to tell the author

How many cards, which photograph, and any `low-resolution` or
`message-truncated` warning. Then: nothing was sent, and here is the PDF to
look at first.
