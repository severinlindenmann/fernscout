---
id: B282
title: The access panel creates a guest link itself, so link management lives on two pages and the page is long enough to scroll past what matters
type: ISSUE
priority: medium
complexity: low
area: web, me-page, contacts
found: "2026-09-04T12:42:00Z"
started: "2026-09-04T13:24:42Z"
merged: "2026-09-04T13:39:49Z"
completed: "2026-09-05T07:45:54Z"
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

## Verified

All four green: `npm run build` compiled, `npx tsc --noEmit` clean, `npx eslint .`
0 errors (4 pre-existing warnings, none in these files), `npx vitest run` 159
files / 2426 tests. `npm run unused` reports no unused files, dependencies or
unresolved imports — which is the check that `components/InviteLinks.tsx` is
gone cleanly rather than merely unmounted.

### Measured, at 390px, signed in as the owner

Both builds served from one content copy with `auth`, `contacts` and `mail` on
and a SQLite database, signed in through the real code flow, measured in a
headless browser at a 390px viewport:

| | Before | After | |
| --- | --- | --- | --- |
| The owner section | 1558px | **970px** | −588px, 38% |
| `main`, whole page | 2393px | **1765px** | −628px, 26% |

Most of that is the two cards `InviteLinks` rendered; the rest is the section
rhythm (`mt-8` → `mt-6` on three sections, `py-8` → `py-6` on the page below
`sm`, and the two `h3`s inside the owner card at `mt-5`).

**Nothing that explains a consequence was removed.** The rendered owner section
still reads, in order: this is your journal · the two lines to hand an agent ·
what the agent gets · the paragraph that is decision 24 in a sentence ("It is
not the same as being signed in here…") · inviting someone · one button. The
stranger branch (B75/B76) is untouched.

Also confirmed live in the same browser: the button leads to
`/example/contacts`, `#invite-trip` is gone from `/me`, and B281's panel there
offers both kinds with the reading link checked and neither disabled.

### One thing the rig taught me

The first "after" measurement rendered `contact.adminNewInvite` as "New personal
link" — the string B281 had already changed. `content/locales/` lives under the
content root, so the strings came from the *copy* of `content/` the test rig was
using, made before B281. Not a defect in either change, and not a deployment
risk here (`scripts/deploy.sh` syncs `content/locales/` and `content/rates/`,
which is exactly what that step is for) — but worth knowing that a locale string
is content, not code, when reading a page that looks a version behind.
