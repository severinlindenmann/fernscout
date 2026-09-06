# The photobook composer, on a phone

**Date:** 2026-09-06
**Status:** describes what is built; the persistence fix in this same change
is the one piece not yet shipped when this was written.

B507 asked for this spec before more code went into the composer. In the day
between it being filed and this being written, ten sibling tickets
(B511–B517, B534, B548–B551, B561–B564, B569) already rebuilt the surface it
was worried about — largely because somebody *did* look at it in a browser
along the way (see the "what came back from looking at the composer" commits)
even though B506, the ticket that was supposed to authorise that look, is
still sitting unverified in `testing/`. This document is therefore mostly a
record of the decisions those tickets already made, checked against the code
and against a real browser at 390px, plus the one gap that verification
found: an arrangement did not reliably survive a reload.

## What the phone layout is

**Two levels, hierarchical, never a wizard, never a sidebar** (B534).

- **Level 1 — the book.** The preview fills the width, first, above
  everything else — no `minmax(0, 20rem)` column beside it, because there is
  no "beside" at 390px. Below it: a "Read the whole book" button (B561), the
  warnings that matter for what gets printed with a one-tap fix where the
  planner knows one (B549), the nine whole-book settings behind a single
  `<details>` (B548), and the order block with the price and the Pay button.
- **Level 2 — one day.** Reached by tapping a spread inside the preview,
  never by a second, competing accordion (B534 explicitly removed the day
  accordion this replaced). The day's own controls sit directly above the
  spread they describe, so the thing being decided and the thing it decides
  are never more than a scroll away from each other. Front matter (title,
  route, colophon) does not drill in at all (B563) — it has no controls of
  its own, only the same whole-book settings level 1 already offers.

Confirmed in a real browser at 390 × 844 (Playwright, `example/parks-2025`,
eighteen days): single column throughout, `-mx-4 sm:mx-0` on both preview
frames so the book runs edge-to-edge on a phone and gains margins back past
`sm`, every interactive control at least `min-h-8`–`min-h-11`, the photo grid
at `grid-cols-3` narrowing to fit a thumb. See `docs/superpowers/specs/`
screenshots taken during this ticket (not committed — see Evidence below) and
the two placed in `.playwright-mcp/` from the B561–B564 session
(`preview-touch-390.png`, `final3-composer-390.png`, `final3-read-days-390.png`).

## Reordering, hero, captions — what "more flexible" turned out to be worth

Decided piecemeal across the sibling tickets, and each holds:

| Asked for | Decision | Where |
| --- | --- | --- |
| Reorder photographs | **In: buttons, not drag.** "A drag on a phone fights the page's own scroll, and these lists are three or four items long" — `DayControls.tsx`. `movePhoto` swaps with a neighbour; ← and → per tile. | B504/B534 |
| Choose the hero photograph | **In.** One tap, radiogroup semantics (mutually exclusive across the day), a star icon. Tapping the current hero again gives the choice back to the planner. | B504 |
| Per-day captions | **Out.** A day's words are its prose (`includeText`), the author's own and printed as written — not a second, composer-local text field. Adding one would be the page editor this ticket explicitly excludes: `plan.ts` still decides which page, which hand, where the gutter is, and a caption is content, not geometry, but editing it here would blur that line for no reader-facing gain the entry itself doesn't already give. | this spec |
| Crop / focal point | **In**, though not asked for by name in B507 — B513 landed the same day and belongs in the same "what's worth it" table: tap or arrow-key nudge, one point per photograph, centred by default. | B513 |
| Leave a day out entirely | **In** — B564. A checkbox, visible and reversible from level 1 even without drilling back in. | B564 |
| Apply one layout to every day | **In** — B516. Confirms first, and only when it would overwrite a hand-made choice. | B516 |

Nothing here turns the composer into a page editor: every one of these is a
question about *what* goes in the book and in what order, never about *where*
on the page it lands. `plan.ts` is untouched by any of it.

## How the preview behaves off-screen

Unchanged from before this spec, and left that way: the preview is a
debounced (400 ms) server round-trip (`POST /<user>/photobook/preview`),
because the plan a person sees has to be the *same* plan `render.ts` will
print, and computing that twice — once for the eyes, once for the paper — is
exactly the drift `docs/plans/W14-photobook.md` warned about. What changed is
what happens once the preview *has* arrived: drilling into a day slices the
already-fetched `preview.html` on the client (`extractSpreads`,
`previewSlice.ts`) rather than asking again, and "read the whole book"
(B561) reuses the same document with one class toggled (`readingHtml`) rather
than a second preview shape. A trip on a slow connection pays the 400 ms
round-trip once per change and nothing per screen it looks at afterward.

**Not done, and deliberately:** offline arranging (queuing changes and
replaying them once a connection returns). Nobody has asked for it, and a
photobook composer that is unusable for thirty seconds of no signal is a
smaller failure than shipping a queue-and-replay system to guard against it.

## Whether an arrangement survives leaving the page

**Yes — `localStorage`, keyed `fernscout:photobook:<tripRef>`, as B511 already
decided:** one person, one device, no lifetime to manage, no "who else can
see this" question a server-side draft would raise. That reasoning stands and
this spec does not revisit it.

**What did not survive it until this change: a reload, in development.**
Verifying this ticket's own acceptance line — "an arrangement survives the
tab closing" — found that a saved arrangement was wiped back to the planner's
defaults on the very next reload, reproducibly, every time, under `next dev`.
It did **not** reproduce under `next build && next start`.

The cause: the restore-then-persist pair of effects guarded the persist half
with a `useRef` flipped to `true` synchronously inside the restore effect.
Under React's Strict Mode development-only double-effect invocation, the
persist effect ran with the ref already `true` but the render's `options`
still at their default — the `setOptions` the restore effect had just queued
had not yet landed in a render — and wrote the default over the real saved
value. `next start` never showed it because Strict Mode's double invocation
is a development-only check; production runs each effect once. So the one
environment an agent can drive locally without deploying (`test-in-a-browser`,
`next dev`) looked broken, and the one real readers are served by did not —
exactly backwards from what a spec's "verify locally" instruction assumes.

**Fixed by making the guard state, not a ref**, in a new
`usePersistedState` hook (`app/[user]/(trip)/photobook/usePersistedState.ts`)
that both the restore and the persist effects share: the flag and the
restored value now change together, in the same render, so the persist
effect's first meaningful run is always the one *after* restoration, never
the one racing it. Verified in a real browser, under `next dev`, across three
consecutive reloads, and covered by
`test/photobook-persistence.test.tsx`, which renders the hook inside
`<StrictMode>` — the only way to reproduce the double invocation at all — and
fails against the ref-guarded version (checked by hand while writing it).

## What this spec is not settling

- **Offline arranging.** Addressed above — out, on request-shape grounds, not
  forgotten.
- **A caption field.** Addressed above — out, on page-editor-boundary
  grounds.
- **Whether B506 itself can now be marked verified.** It cannot: this spec
  and its evidence cover the composer's mobile layout and its persistence,
  which is a slice of what B506 asks for, not the drawn-travellers half, and
  not a person's own look. B506 stays in `testing/` for somebody to pick up
  in full.

## Evidence

- Screenshots taken during this ticket's own verification (`example/parks-2025`
  at 390 × 844, Playwright, `next dev` with the demo journal) are not
  committed — see `test-in-a-browser`'s own rule about not committing what a
  local capability-probe touches. The composer's overall shape, the level-2
  drill-in, and the persistence race were each confirmed visually and by
  reading `localStorage` directly rather than only from the DOM.
- `test/photobook-persistence.test.tsx` is the regression test for the one
  thing that did not hold up: a real, runnable, and — checked by hand —
  actually catches the bug it is named for.
