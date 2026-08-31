---
name: generate-photobook
description: Turn a Fernscout trip into a print-ready photobook PDF, with a preview and a provider request. Use when the user says "make a book", "photobook", "print the trip", "album", or asks what it would cost to have a trip printed.
---

# Generate a photobook

```bash
npm run photobook -- --trip <username>/<trip-id>
```

Dry run by default: it writes into `content/<username>/photobooks/` and calls
nobody. That is the whole pipeline minus the account, which is deliberate —
see `docs/providers/photobook.md`.

The `--trip` argument is a **ref**, `<username>/<trip-id>`, not a bare id. The
owner decides which folder the book lands in.

## Steps

### 1. Look at the outline before rendering anything

```bash
npm run photobook -- --trip <user>/<trip-id> --outline
```

Prints every page: title, intro, route, chapters by country, day spreads,
photo pages, costs, colophon. This is where a bad book is cheap to fix.

**Count the blank pages at the end.** Perfect binding rounds up to a multiple
that starts at 32 pages, so a short trip ends in a drift of blanks:

```bash
npm run photobook -- --trip <user>/<trip-id> --binding saddle
```

Saddle stitch runs 4–48 pages and is the right binding for anything short.
Perfect binding (32–160) is for a real trip.

### 2. Choose a size

```bash
npm run photobook -- --trip x   # with no other flags, prints the size list
```

Default is `square-210`. `--size portrait-a4`, `--size landscape-a4` and the
rest are listed by the usage message.

### 3. Render

```bash
npm run photobook -- --trip <user>/<trip-id> --binding saddle
```

Writes to `content/<user>/photobooks/` (gitignored):

| File | For |
| --- | --- |
| `<trip>-interior.pdf` | The pages |
| `<trip>-cover.pdf` | The cover, sized for the computed spine |
| `<trip>-preview.html` | **Open this.** Every spread in a browser |
| `<trip>-plan.json` | The layout decisions, as data |
| `<trip>-pdfx.txt` | What this file honestly is, print-wise |
| `<trip>-<provider>-request.json` | The order that *would* be sent |

Add `--guides` to draw trim and safe-area guides — for proofing, never for the
file you send.

### 4. Read the warnings, because they are invisible on screen

- **`low-resolution`** — the photo cannot reach 300 DPI at the printed size. It
  looks perfect on a laptop and soft on paper. Use the camera original, not a
  web-sized copy. The example content is 1200 px and always warns.
- **PDF/X readiness** — the report at the end lists what is and is not met. Out
  of the box the file is **DeviceRGB with Base-14 fonts referenced rather than
  embedded**, so it declares no PDF/X version. Every print provider wants
  PDF/X, so:

```bash
npm run photobook -- --trip <user>/<trip-id> --icc /path/to/FOGRA39.icc
sh content/<user>/photobooks/gs-pdfx.sh      # Ghostscript does the conversion
```

Use the ICC profile **the printer names**. On macOS
`/System/Library/ColorSync/Profiles/Generic CMYK Profile.icc` exists for
testing and is not what you order with.

### 5. Ordering

```bash
npm run photobook -- --providers
```

Everything except `dry-run` reports "needs setup" and refuses to run, by
design: the request builders are written and tested, and the accounts are not
this repository's business. **Lulu has a free sandbox — start there.**
`docs/providers/photobook.md` has endpoints, page-count rules and prices.

Nothing is ever sent without credentials being present. If the user asks you to
order a book, tell them what is missing rather than pretending to place it.

## What to tell the author

The preview HTML, the page count, the binding you chose and why, and any
low-resolution warning by filename. A soft photograph is worth catching before
it is printed and posted.
