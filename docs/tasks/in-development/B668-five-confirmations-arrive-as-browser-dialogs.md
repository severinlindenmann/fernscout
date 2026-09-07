---
id: B668
title: Five confirmations arrive as browser dialogs rather than as the page
type: ISSUE
priority: medium
complexity: low
area: me-page, photobook, docs
found: "2026-09-07T08:45:00Z"
started: "2026-09-07T08:35:42Z"
session: 52155fa5-6d95-440e-9de1-0e41d34e7f3d
claimed: "2026-09-07T08:35:42Z"
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
