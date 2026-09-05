# Ordering a photobook from the gallery

**Date:** 2026-09-05
**Status:** design, approved in chat, not built

The photobook pipeline has produced print-ready PDFs since the photobook work
package, and in that time nobody has ordered one — for the same reason nobody
posted a postcard before B434. Using it needs a shell on the server and a
trip ref typed at a prompt. The missing piece was never the rendering.

This design adds the missing piece: a page where the journal's owner picks a
format and a set of photographs, watches the book change as they do, sees what
it costs, and presses one button. The button spends credits, builds the PDFs
and sends a mail. **It prints nothing.** No provider is called, because no
provider account exists yet — Gelato is the chosen provider (see
`docs/providers/photobook.md`, and the research in the session that produced
this file) and connecting it is separate, later work.

The point of stopping there is not caution. It is that everything upstream of
the provider — the options, the layout, the price, the money, the mail, the
files — is the part that has never been exercised end to end by a person
clicking. Gelato's request builder already exists and is fifty lines. The
thing worth proving first is that the book somebody configures in a browser is
a book they want.

## What is already here

| | |
| --- | --- |
| `lib/photobook/source.ts` | trip on disk → `BookSource` (days, photos, route, costs) |
| `lib/photobook/plan.ts` | `BookSource` + `BookSpec` → `Photobook`: every page, every rectangle, volumes, warnings |
| `lib/photobook/render.ts` | plan → interior and cover PDFs |
| `lib/photobook/preview.ts` | **the same plan** → HTML where every rectangle is the same `RectMm` |
| `lib/photobook/spec.ts` | `BOOK_SIZES`, `BINDING_PROFILES`, geometry |
| `lib/photobook/providers.ts` | request builders for four providers, none called |
| `lib/postcard/orders.ts` + `send.ts` | the flow this one mirrors, in full |
| `print_orders` | in the schema since `001-initial`, `kind` documented as `postcard \| photobook` |
| `lib/mail` | attachments, templates, `.eml` files under `content/<user>/mail/` in dev |

Nothing in this design invents a subsystem. It joins six that exist.

## Decisions taken before the design

Four questions were asked and answered; the answers are the frame.

1. **Owner only.** The button and both routes are the owner's, exactly like
   postcards. Not trip people, not guests. Credits are the owner's balance and
   there is no second payer to model.
2. **The mail carries links, not the PDF.** A 60-page book at 300 DPI is
   hundreds of megabytes; no mailbox takes it. The mail links to both files.
3. **All four option groups ship in v1:** size and binding, photo selection,
   day text on/off, and the map-spread / locations / names / costs toggles.
4. **The credits are really spent.** Balance checked, debited, refunded if the
   render fails. The money path is exercised for real; only the printing is
   absent.

## Architecture

```
gallery page ──button──▶ /<user>/photobook  (options + live preview)
                              │
                              ├── POST …/photobook/preview  → HTML + pages + price
                              │      buildBookSource → planBook → renderPreview
                              │
                              └── POST …/photobook/order    → spend → render → mail
                                     print_orders row, kind: photobook
                                     content/<user>/photobooks/<id>/{interior,cover}.pdf
                                     mail links to /<user>/photobooks/<id>/interior.pdf
```

Both routes sit **outside `/api/v1/`** and are satisfied only by the owner's
browser cookie; a bearer token is refused outright. That is the same
construction as `app/[user]/postcards/[id]/send/route.ts` and it is the whole
enforcement of "an agent never spends the owner's money": not a scope check a
refactor can invert, but the absence of a door. A test asserts that nothing
under `app/api` imports the order builder, mirroring
`test/postcard-orders.test.ts`.

### Why the preview is server-rendered HTML in an iframe

`renderPreview` already exists and is explicitly *not* a second layout engine:
every rectangle it emits is the same `RectMm` the PDF renderer draws, expressed
as a percentage instead of in points. Re-implementing the layout in React
would create the second engine that file was written to avoid, and it would
drift within a month.

So the preview page posts its options, the server plans the book and returns
`renderPreview`'s HTML, and the page shows it in an iframe. If a photograph is
in the wrong place in the preview it is in the wrong place on paper, which is
the only property worth having.

One change is needed in `preview.ts`: it computes `<img src>` as a path
relative to an output directory, because it was written to be opened from a
folder. It gains an optional `srcFor?: (photo: BookPhoto) => string` callback
so the web caller can hand back the `/media/…` URL the site already serves.
Default behaviour is unchanged, so the CLI is untouched.

### Why the PDF is built synchronously, on pay

The order route spends, renders, mails, and answers — in that order, in one
request. Rendering embeds JPEG bytes without re-encoding, so it is I/O rather
than CPU, but on a long trip it is still tens of seconds and hundreds of
megabytes.

That is accepted rather than hidden: it is one user pressing one button a few
times a year, and a job queue for that is a subsystem to operate, monitor and
recover. The ceiling is recorded in the code as a `ponytail:` comment naming
the upgrade path (render after responding, mail when done), and the page shows
a progress state rather than an unexplained wait.

## Components

### 1. The gate — `lib/photobook/entry.ts` (new)

`photobookEntryFor(trip): Promise<PhotobookEntry | undefined>`, a near-copy of
`lib/postcard/entry.ts`. Returns `undefined` unless:

- `photobook` and `credits` are both enabled for this journal, and
- the reader is the owner.

`undefined` for everybody else, so the gallery gets nothing to render rather
than a flag to remember to check. The gallery page **must not** call `isOwner`
itself: `test/draft-audience.test.ts` fails any file under `app/[user]/` that
mentions drafts and calls `isOwner`, and the gallery page decides draft
visibility a few lines earlier. That rule is why the postcard gate is its own
file, and it applies here unchanged.

The routes ask for themselves; being wrong here is cosmetic, not a way in.

### 2. The button — `app/[user]/(trip)/gallery/GalleryPageContent.tsx`

A second control beside *Postkarte senden*, rendered only when
`photobookEntryFor` returned something and `media.length > 0`. `BookOpen` from
lucide, `t("photobook.start")`, and unlike the postcard button it is a plain
link rather than a picker — a book is the whole trip, so there is nothing to
select in the gallery first.

`app/[user]/(trip)/gallery/page.tsx` calls the gate and passes the result down,
the same one-call shape as `postcard`.

### 3. The options page

`app/[user]/(trip)/photobook/page.tsx` for the current trip, and
`app/[user]/trips/[trip]/photobook/page.tsx` for a past one, both delegating to
one `PhotobookPageContent` — exactly how the two gallery routes already pair.
Both re-run `mayReadTrip` and the owner gate; neither trusts the button's
existence.

Layout: options on the left, preview on the right, and on a phone the preview
below. The right column also carries page count, spine width, the planner's
warnings, the price in credits, the current balance, and the Pay button.

**The planner's warnings are not decoration.** `planBook` already reports
low-resolution photographs, padding with blanks, and volume splits — failures
that are invisible on screen and obvious on paper. They appear above the Pay
button, not folded away.

### 4. The options themselves — `BookOptions`

A new type, defaulted so that an owner who changes nothing gets today's CLI
book, threaded into `buildBookSource` and `planBook`:

| Field | Effect | Lands in |
| --- | --- | --- |
| `size` | `square-210` \| `landscape-a4` \| `portrait-a4` | existing `BOOK_SIZES` |
| `binding` | perfect \| saddle | existing `BINDING_PROFILES` |
| `excludePhotos: string[]` | photographs left out | `buildBookSource` |
| `includeText` | day prose; off gives a pure photo album | `planBook` |
| `includeMap` | the two-page route spread | `planBook` |
| `includeChapters` | country/location chapter dividers | `planBook` |
| `includeNames` | travellers in the byline | `buildBookSource` |
| `includeCosts` | the cost summary page | `buildBookSource` |

This is the expensive part of the work and the design says so plainly.
`plan.ts` is a thousand lines written to be deliberately unconfigurable — "no
template system, no theme layer and no per-trip override", in its own words,
because a template system is a way of avoiding a decision rather than making
one. Four booleans is not a theme layer, and the reasoning survives: these are
not styling knobs, they are *what is in the book*. But each one changes the
page count, so the too-short growth pass and the too-long volume split re-run
against the new number, and each one needs a test that the resulting plan is
still legal against the binding rule.

The photo grid reuses the gallery's own tiles. All photographs are selected on
arrival; clicking one excludes it. Excluding photographs is the fastest way to
fall under the 32-page minimum, so the planner's "padded with blanks, consider
saddle stitch" warning is the one an owner will meet most.

### 5. Price — `lib/credits/pricing.ts`

`PHOTOBOOK_CREDITS` joins `POSTCARD_CREDITS` in the client-safe pricing module,
for the reason that module exists: the page must render a price before anything
is pressed, and `lib/credits.ts` is `server-only`.

A base plus a per-page term, integer credits, computed by a function rather
than a constant because the page count is not known until the book is planned:

```ts
export function photobookCredits(pages: number, size: BookSize): number
```

**The numbers are placeholders and are commented as such.** A real figure needs
Gelato's `/v3/products/{productUid}/prices` endpoint and an account, which is
the next work package. Until then the constant carries the same discipline as
`BINDING_PROFILES`' `verified: false`: it must not be able to present itself as
fact. A test asserts the placeholder marker is still there, so replacing it is
a thing somebody notices doing.

### 6. Orders — `lib/photobook/orders.ts` (new)

Rows in `print_orders`, `kind: "photobook"`. The payload holds the trip ref,
the `BookOptions`, the resulting page count, the volume count and the price
charged. It does not hold anything derivable from the trip on disk, so a book
re-rendered later is re-rendered from the same content.

Unlike a postcard order this row is created **at pay**, not before: there is no
proposal step, because the person configuring the book and the person paying
for it are the same person looking at the same screen. The claim-then-spend
ordering that protects a postcard from a double press still applies — the row
is inserted and claimed in one statement, and a second press finds it taken.

### 7. Building and mailing — `lib/photobook/build.ts`, `receipt.ts` (new)

`build.ts` is options → `buildBookSource` → `planBook` → `render` → files under
`content/<user>/photobooks/<orderId>/`, which is already gitignored. It is the
same three calls `scripts/photobook.ts` makes, so the CLI and the button
produce the same book.

`receipt.ts` follows `lib/postcard/receipt.ts`: what was ordered, how many
pages, how many credits, and links to the interior and cover PDFs. In
development it lands as an `.eml` under `content/<user>/mail/`, which is how
the whole thing is testable with no account anywhere.

### 8. The download route

`app/[user]/photobooks/[id]/[file]/route.ts`, owner cookie only, serving the
two PDFs from the order's directory with a traversal guard on the filename.

This is also the piece the provider work will need. **All four candidate
providers, Gelato included, fetch the PDF from a URL and none accepts an
upload** — so a reachable link is not scope creep here, it is the one
infrastructure decision `docs/providers/photobook.md` says is much better made
now than on the evening somebody wants to order a Christmas present. What this
design builds is the owner-gated version; making it unguessable-but-public for
a provider to fetch is a later, separate change.

### 9. Capability

`photobook` is `{ env: [], db: false }` in `lib/capabilities.ts`. Orders and
credits are rows, so it becomes `db: true`. `/api/health` then explains
correctly why the button is absent on an instance with no database.

## Error handling

| Case | Behaviour |
| --- | --- |
| Not the owner | Gate returns `undefined`; routes 404. No control ever rendered. |
| Capability off | Same. `/api/health` says why. |
| Balance too low | Refused before anything is charged, with the price and the balance, and a link to buy credits. All-or-nothing, per `lib/credits.ts`. |
| Double press | Second press finds the row claimed and is a no-op returning the first order. |
| Render throws | Credits refunded, order marked failed, the page says so. A book nobody got bought nothing. |
| Plan illegal (too few pages, no photos) | Refused at preview time, so Pay is never enabled against a book that cannot be bound. |
| Mail unavailable | The order stands and the files exist; the page shows the links directly. A missing mail must not lose a paid book. |

## Testing

- `test/photobook-options.test.ts` — each `BookOptions` field changes the plan
  in the stated way, and every resulting plan is legal against its binding rule.
- `test/photobook-orders.test.ts` — claim-then-spend ordering, double press
  charges once, refund on render failure, and **nothing under `app/api`
  imports the order builder** (the postcard test's shape).
- `test/photobook-preview.test.ts` — `srcFor` changes only the `src`
  attributes; default output is byte-identical to today's.
- `test/photobook-pricing.test.ts` — the placeholder marker is still present.
- Manual, and not automatable: the dev server boots with `photobook` on and
  off, and an `.eml` with two working links lands under `content/<user>/mail/`.

## Explicitly not in scope

- **No provider call.** Gelato is chosen and its builder exists; connecting it
  is the next work package and needs an account, a real `productUid` and a real
  price.
- **No cover editor.** The title comes from `trip.md`.
- **No hardcover.** `BookSpec.coverBoardMm` exists, but no provider spec is
  verified, so offering it would be a knob that lies.
- **No agent-facing API.** Ordering is a person pressing a button. An agent
  that wants a book can run the CLI.
- **No job queue.** See the synchronous-render decision above.
