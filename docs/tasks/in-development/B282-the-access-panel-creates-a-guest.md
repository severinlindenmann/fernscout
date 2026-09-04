---
id: B282
title: The access panel creates a guest link itself, so link management lives on two pages and the page is long enough to scroll past what matters
type: ISSUE
priority: medium
complexity: low
area: web, me-page, contacts
found: "2026-09-04T12:42:00Z"
started: "2026-09-04T13:24:42Z"
session: a3370c43-40d9-471c-a3d3-1a30c49b5302
claimed: "2026-09-04T13:24:42Z"
---

# B282 — The access panel creates a guest link itself, so link management lives on two pages and the page is long enough to scroll past what matters

## Why

`/<user>/me` is the owner's own page — who they are signed in as, what they can
read, how to hand the journal to an agent — and it also issues invite links, via
`components/InviteLinks.tsx` mounted at
`app/[user]/me/MePageContent.tsx:260`. Five lines below it there is already a
link to the page where links are actually managed
(`app/[user]/me/MePageContent.tsx:272`, "Verwalten, wer mitlesen darf").

So the owner can *create* a link on `/me` and can only *see, revoke or re-send*
it on `/contacts`. Two pages, one job, and the created link's URL is shown once
on the page that cannot list it — after which it is unrecoverable (B280). The
"Lese-Link erstellen" button is the shape of the problem: it is the one control
on this page that produces something this page then cannot show you.

The page is also long for what it says. Every section is a full-width card with
its own heading and a paragraph of prose — signed-in-as, what you can read, your
details, this is your journal, the agent handover, what the agent gets, inviting
someone, sign out. On a phone the owner scrolls past four explanatory paragraphs
to reach the two things they came for. The prose is deliberate and the audience
is real — this is the page written for the reader least comfortable with
software — so the fix is density, not deletion.

## Work

- **Remove `InviteLinks` from `/me` and delete the component.** Link creation
  moves to the contacts panel in B281, which must be merged first — otherwise
  there is a commit on `main` with no way to make a link at all. This task owns
  both the mount and the file, so `npm run unused` stays clean in one step.
- **Promote the existing contacts link to a proper button** — the primary
  control in that section, worded as what it leads to: create and manage who
  reads along, and the links that let them ask. `me.contacts` already says
  something close; the wording may need to widen now that it also covers links.
- **Compact the page.** Same content, less height: sections that are one
  sentence and one control do not each need a bordered card and an `mt-8`;
  "signed in as" and "your details" are one row; the two `h3` blocks inside the
  owner card ("what the agent gets", "inviting someone") tighten once inviting
  is a single button. Keep every sentence that explains a consequence — the
  token warning at `MePageContent.tsx:247` is decision 24 in a sentence and does
  not go.
- **Do not touch the stranger branch** (`me.strangerTitle`, the "ask this person
  by name" block). B75/B76 are why it reads the way it does.

Not doing: the agent handover block — that is B283, and it changes what the
block *is* rather than how tall it is. Expect the two tasks to touch the same
file; whichever lands second rebases.

## Acceptance

- `/<user>/me` has no link-creating control, and one button leading to
  `/<user>/contacts`.
- `components/InviteLinks.tsx` is gone and `npm run unused` is clean.
- With `contacts` off, the button is absent rather than dead — the rule
  `MePageContent.tsx:265` already states for the old link.
- The owner section is measurably shorter at 390px wide (record the before and
  after height in this task), with no sentence removed that explains what
  something does.
- All three locales carry any changed string.
- The four checks pass.
