---
id: B1257
title: The helper preview tells the owner that publishing is somebody else's to ask for, beside a button that does it
type: ISSUE
priority: medium
complexity: low
area: helper, drafts
found: "2026-09-10T09:59:55Z"
---

# B1257 — The helper preview tells the owner that publishing is somebody else's to ask for, beside a button that does it
## Why

The helper's **How it looks** tab, opened by the owner of the journal on their
own unpublished day, shows this — with a **Put this day on the site** button
sitting 60px above it:

> **Draft — not on the site yet**
> You can read this because you were on this trip. Nobody else can… **Putting it
> on the site is for whoever keeps this journal to ask for — tell them when you
> are happy with it.**

The person reading it *is* whoever keeps this journal. They are being told to go
and ask themselves, on a screen that is already offering them the button.

The mechanism is `components/DraftNotice.tsx:44`:

```ts
const canPublish = useTrip()?.canPublish ?? false;
```

and the comment above it makes the choice deliberately: *"Null context — a draft
outside a trip page — takes the narrower copy, which is the safe direction: it
never tells anybody that a day is theirs to publish."* That reasoning is right
for a draft rendered somewhere with no trip context. The helper's preview is not
that place — it knows exactly whose journal it is, and it is rendering a publish
control from the same knowledge.

So the bug is not the fallback. It is that the preview pane renders
`DraftNotice` without the context it could supply.

## Also worth a decision while you are here

The banner is `bg-coral-300` with a `border-2 border-coral-600`, eight lines
tall, and larger on a phone than the day it is warning about. Being loud is
deliberate (B327, and the comment says so). Being *taller than the content* on a
390px screen, in a state that is the default for everything an agent writes, is
a different question. Either is fine to leave; both being true at once is what
makes the first screen of a new journal read as an error.

## Work

- Give the helper's preview the trip context it already has, so `canPublish` is
  answered truthfully and the owner sees `draft.title` / `draft.body`.
- Do not change the fallback: a draft with no context should keep the narrow
  copy.

## Acceptance

- The owner's own draft, previewed in the helper, shows the owner's wording.
- A trip companion previewing the same day still sees `draft.bodyShared`.
- A draft rendered with no trip context is unchanged.
