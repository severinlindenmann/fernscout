# One order element, for books and for cards

*Written 2026-09-11, before the work. Intent as it stood; not corrected
afterwards — `docs/plans/` is the record, not the documentation.*

Drafts this plan was approved from:

- the three styling options — <https://claude.ai/code/artifact/3252f0d3-f51e-486e-916f-b1bbd65c1c78>
- the chosen skin, every screen — <https://claude.ai/code/artifact/8a9b50ff-9a6a-4257-a0ca-9c462ab1acfd>

Option **B, "the docket"**, was chosen: the object gets a plate on the left,
and status, ledger and action stay together on the right.

## The problem, in one paragraph

A photobook order and a postcard order answer the same four questions — what is
this, where does it stand, what did it cost, who is it going to — and share no
code. The envelope block is hand-written three times; the status pill and its
tone table live only on the photobook receipt; the price ledger shipped on the
photobook receipt in B1461 and does not exist on the postcard page at all. Every
change to an order is two changes, and the two have already drifted.

## What is being replaced, and what is not

**Replaced.** Every surface that presents an *order*: the photobook receipt
page, the photobook buy panel, the postcard order page's head and body, and the
postcard `Send` step. These become one component fed by one view model.

**Not replaced, and not for tidiness — for a reason.** Composing is not
ordering. The photobook wizard, the composer and its spreads, and the postcard
`Look` and `Write` steps stay exactly where they are. They are how a thing is
*made*; the shared element starts where making stops. `PostcardBack` in
particular keeps every behaviour it has, including that an agent's words are a
first draft the owner writes over, saved on a 700 ms debounce with no Save
button to miss.

The drafts show the composing screens re-skinned. That is the *grammar* the
order element has to match, not work this programme is doing.

## The shape

Three layers, so that the money and the markup are never the same diff:

```
lib/order/view.ts          OrderView + one adapter per product   (no JSX)
components/order/          OrderDocket + its parts               (no data)
app/…/page.tsx             the four surfaces, thinned            (no vocabulary)
```

`OrderView` is the six slots the drafts settle on: `head`, `status`, `ledger`,
`recipients`, `object`, `action`, plus `meta`. A product fills what it has. A
photobook has no `action` — it is bought before its order page exists; a
postcard proposal has no files.

Two rules the split exists to protect:

- **The status vocabulary lives in one place.** The Gelato mapping and its
  rule — a word this instance has not mapped keeps its raw English and the
  neutral tone, because colouring an unknown status green would be inventing a
  fact about somebody's book (B1451) — moves into the adapter whole.
- **Nothing about spending moves.** The postcard send route is the only thing
  in the codebase that spends credits at a printer, it takes the owner's cookie
  only, and `test/postcard-orders.test.ts` fails if anything under `app/api`
  imports `sendOrder`. This programme is presentation; that assertion must be
  as true after it as before.

## The order of the work

| | Ticket | What lands |
| --- | --- | --- |
| 1 | **B1463** | `OrderView` and the two adapters. Invisible in a browser by design — no JSX in the diff. |
| 2 | **B1464** | `OrderDocket` and `/docs/branding/order`, a bench showing every state with no database, no session and no capability. |
| 3 | **B1465** | The photobook receipt page swaps to it. |
| 4 | **B1466** | The photobook buy panel swaps to it. |
| 5 | **B1467** | The postcard order page and its `Send` step swap to it. |
| 6 | **B1468** | The delete sweep — dead files, dead exports, dead locale keys. |
| — | **B1469** | The cover plate. Parallel, and deliberately not a dependency. |
| — | **B1470** | Driving all of it on the live instance. |

Steps 1 and 2 are the whole design decision; 3 to 5 are mechanical and can be
built concurrently once 2 has merged, because they touch four different files.
6 runs last, alone, because a delete sweep that shares a branch with a feature
is a delete sweep nobody can review.

**B1469 is parallel on purpose.** Nothing renders a thumbnail of a built book
today. The layout holds without one — a photobook shows its size-and-cover block
in that slot — so the plate is optional by design rather than a to-do the
redesign waits on.

## What gets deleted

The programme should end smaller than it started. Known candidates, each to be
confirmed by `npm run unused` rather than by eye:

- `components/PhotobookPrintPanel.tsx` — `addressLines` moves into the shared
  `Envelope`, and the file's other half was already deleted by B1428.
- `KNOWN_STATUSES`, `TONE_CLASSES`, `DOT_CLASSES` in the receipt page.
- The envelope markup in `BookLevelView.tsx`, the receipt page and the postcard
  people list — three copies, one survivor.
- The postcard page's title/intro ladder across three order states.
- Whatever `photobook.print.*` and `postcard.page.*` keys those carried, from
  all three locales, regenerated with `npm run i18n:keys`.
- `photobook.print.legacyNoPrintDoor`, **if** the live database holds no
  pre-B1157 order outside the demo journal. Check before deleting; a real row
  behind that branch is somebody's book.

`npm run unused` runs as part of `verify` and is the gate after each merge.

## How it gets looked at

A green suite says the mechanism works on the case it was built for, which is
the one case that cannot surprise anyone. Every visible ticket here is finished
only when it has been *seen*, at both widths, on content that existed before the
branch (B1090).

1. **The bench** — `/docs/branding/order`, at 1440 and at 390. Every state
   including the ones a reader cannot reach: refused-and-refunded, an unmapped
   printer word, an expired proposal, a pruned book. No database needed, so this
   is the fast loop while building.
2. **Locally, in a real browser** — the `test-in-a-browser` procedure: owner
   cookie from `get-token.sh`, capability on, 390 px first and only then wider.
   Check the console for hydration errors; the composer has client state and
   this touches the panel under it.
3. **On the live instance** — B1470. The real order `9f1b3820` at both widths, a
   book bought end to end on a test journal, and a postcard order carried
   through Look, Write and Send including editing the agent's words. One order
   read in German and one in Hungarian, to catch a string that only reads in
   English.
4. **A persona round** on the postcard flow (`test-with-personas`) if step 3
   turns up anything about wording. The cards are the path a non-technical
   person walks.

Horizontal scroll is a failure, not a nit: assert
`document.documentElement.scrollWidth === clientWidth` at 390 rather than
reading a screenshot for it.

## Risks worth naming

- **Two agents, four surfaces.** B1465 to B1467 are concurrent, and all three
  import the same new component. If its props change mid-flight, the last one to
  merge pays. Freeze `OrderView` at the end of B1463 and treat a change to it
  afterwards as its own ticket.
- **The price a person was shown.** B1466 touches the panel that carries B595's
  stale-price refusal. Markup only — if the diff changes what `quoteBookFor`
  returns or when it is called, it has gone wrong.
- **A thinner page is not a smaller page.** The receipt page is 401 lines mostly
  because of its comments, which record why each rule exists. Move the reasoning
  with the code; a rule whose reason was deleted is a rule the next change
  removes.
- **Locale drift.** New strings need real German and real Hungarian. Nothing
  checks that a translation means anything, so a plausible machine translation
  ships and is read by somebody whose language it is.

## What this programme is not

Not a CMS, and not a second way to spend. Nothing here adds a route, a token
scope or a button that moves money; the only new capability in the whole set is
B1469's cover thumbnail. If a diff in this programme needs `/openapi.json`
updating, something has gone further than it was meant to.
