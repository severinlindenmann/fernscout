---
id: B668
title: Five confirmations arrive as browser dialogs rather than as the page
type: ISSUE
priority: medium
complexity: low
area: me-page, photobook, docs
found: "2026-09-07T08:45:00Z"
started: "2026-09-07T08:35:42Z"
merged: "2026-09-07T08:45:34Z"
---

# B668 — Five confirmations arrive as browser dialogs rather than as the page

## Why

Five places ask a person to confirm something with `window.confirm`, so the
question arrives in the operating system's own type, in a box with a generic
title bar naming the domain, over a page that has spent some effort looking
like somebody's travel journal:

- `app/[user]/me/MePageContent.tsx:144` — buying 5 GB of storage (B661)
- `app/[user]/me/MePageContent.tsx:204` — the cleanup (B664)
- `app/[user]/me/MePageContent.tsx:206` — and its second question about
  staged documents, which arrives as a *second* stacked dialog
- `app/[user]/(trip)/photobook/PhotobookPageContent.tsx:344` — reset all days
- `app/[user]/(trip)/photobook/PhotobookPageContent.tsx:372` — apply to all

**This is already a decided question and the decision went the other way.**
B633 replaced exactly this with a panel in `components/DayNotify.tsx`, and its
doc comment gives the reasoning in full: a browser dialog does not look like
the journal it belongs to, and it cannot answer the question the person
actually has, because it renders one string and nothing else. The two storage
ones are the same shape as that one — money and deletion — and they were
written after it.

Two of them are worse than cosmetic. The cleanup asks twice, so somebody who
presses Free up gets a dialog, answers it, and is immediately handed another
dialog about a different thing — which reads as a stutter rather than as two
questions. And a `confirm()` cannot show what it is about to remove: "9.1 MB"
is a number, where the panel could name the categories beside it.

The rule is not written down anywhere, which is why B661 and B664 both reached
for `confirm()` a week after B633 argued against it.

## Work

- Replace all five with in-page confirmation, following
  `components/DayNotify.tsx` — a panel with the question, a confirming button
  and a cancel, `role="dialog"` with `aria-modal="false"`, in the flow rather
  than over it.
- The cleanup's two questions become **one** panel: the categories with their
  sizes, and the staged documents as a checkbox inside it rather than a second
  dialog after the first.
- Write the rule down where the next person will meet it — AGENTS.md, since
  this is not one skill's business. `window.confirm`, `alert` and `prompt` are
  not used; a confirmation is a panel, and B633 and this task are why.
- A test that fails on a new `window.confirm` under `app/` or `components/`,
  in the shape `test/depersonalised.test.ts` already uses — prose asking
  nicely is what did not work the first time.

**Not doing:** a shared `<ConfirmPanel>` component. There are two shapes here
(a money question and a deletion question) and they say different things;
extracting one abstraction from two call sites before either has settled is
how it ends up with six props and a `variant`.

## Acceptance

- `grep -rn "window\.confirm\|window\.alert\|window\.prompt" app components`
  returns nothing but comments explaining the rule.
- Pressing Free up on `/<user>/me` shows a panel in the card naming what will
  go and what will not, with the staged documents as one checkbox inside it —
  and cancelling deletes nothing.
- The same for buying storage, and for both photobook buttons.
- A test fails when a native dialog is reintroduced.
- The rule is in AGENTS.md.
- `npm run verify` passes.

## What was built

All five are gone. `components/ConfirmPanel.tsx` is the replacement: a panel
in the flow, `role="dialog"` with `aria-modal="false"` and no focus trap —
the same call `DayNotify` (B633) and `PushPrompt` already make. The confirming
button says what it *does* ("Delete them", "Buy 5 GB", "Undo my arrangement")
rather than "OK", so somebody who has stopped reading by the time they reach
the buttons can still tell the two apart.

**The cleanup's two dialogs are one panel.** The staged documents are a
checkbox inside it, unticked, rather than a second dialog stacked on the
first — which is the thing `confirm()` could not do and the reason the
sequence read as a stutter.

**The photobook's two hold their question in `pending` at the page's top
level**, and the panel renders where the outcome notice already appears. Both
controls live two components down (`BookLevelView`, `DayLevelView`), and
threading a panel plus two callbacks down to sit beside each button is more
wiring than the question is worth; both levels are in one fragment, so one
panel serves both.

**I extracted the shared component after saying I would not.** The Work
section above argued two call sites with different shapes did not justify one;
by the time the photobook's pair joined the storage card's there were four
with one shape, and the alternative was copying the same markup into a second
file. The note is left standing above rather than edited away — it was the
right call on two and the wrong one on four.

`test/no-browser-dialogs.test.ts` is the half that holds: it scans `app/` and
`components/` for `confirm`/`alert`/`prompt`, strips comments first so the doc
comments explaining the rule may name it, and has two tests of its own regex —
one that it catches the five spellings, one that it does not fire on
`onConfirm`, `confirmLabel` or `agentConfirm`. The rule is in AGENTS.md too,
under "Working in this repository".

## Acceptance — evidence

- `grep -rn "window\.confirm\|window\.alert\|window\.prompt" app components`
  returns only doc comments explaining the rule. Mechanised by
  `test/no-browser-dialogs.test.ts`.
- The guard test fails on a reintroduced dialog and passes on ordinary code —
  both directions asserted rather than only the one.
- `npm run verify` passes: 317 files, 4138 tests.

**For whoever verifies this**, four buttons to press, and cancel each one
first: Free up and Add 5 GB on `/<user>/me`, and on a trip's photobook page
"Let the book decide, for every day" and a day's "Apply to every day". Nothing
should happen on cancel, and no operating-system box should appear at any
point. The one worth looking at hardest is the cleanup's checkbox — ticking it
must be what decides whether the staged documents go.
