---
id: B271
title: The owner's contacts page has no way back to the journal
type: ISSUE
priority: medium
complexity: low
area: web, contacts, navigation
found: "2026-09-04T11:34:00Z"
started: "2026-09-04T11:55:54Z"
merged: "2026-09-04T12:08:09Z"
completed: "2026-09-05T07:45:54Z"
---

# B271 — The owner's contacts page has no way back to the journal

## Why

`/<user>/contacts` is the only page inside a journal that renders no header.
`components/ContactsAdmin.tsx:708` opens straight into a bare
`<main className="mx-auto w-full max-w-3xl px-6 py-12">` — no journal title, no
`SiteNav`, no link home. Every other page under `app/[user]/` mounts
`components/PageHeader.tsx`: the story, `/search`, `/trips`, `/me`, `/costs`,
`/gallery`, `/map`. The layout deliberately renders no chrome of its own
(`app/[user]/layout.tsx` provides only the four context providers), so a page
that does not ask for the header does not get one.

It is the page the approval email links into, which is exactly the arrival that
has no history to go back to — a fresh tab from a mail client, on a phone, where
there is no browser back button pointing anywhere useful. The owner approves a
guest and is then stuck on a page with no exit but the URL bar.

Note the asymmetry: the *non-owner* branch of the same route already answers
this. `app/[user]/contacts/page.tsx:44` hands `NoticeShell` a
`err.goToJournal` action. Only the owner — the one person who reaches this page
routinely — is left without one.

## Work

Render `PageHeader` above the contacts `<main>`, the way
`app/[user]/me/MePageContent.tsx:86` does, wrapped in the same
`<div className="min-h-screen">`. That is the whole change: the header's journal
title already links home (`PageHeader.tsx:30` falls back to `site.base` when
there is no trip in context, which is the case here, as it is on `/me`), and it
brings the nav, the language switcher and the skip link with it.

**Composed in `app/[user]/contacts/page.tsx`, not inside `ContactsAdmin` —
corrected while building.** `/me` puts the header inside its content component,
so that was the plan here too, and it breaks `test/guest-list-links.test.tsx`:
that test renders `ContactsAdmin` with no providers at all, and `useSite()`
throws outside `SiteProvider` (`components/SiteProvider.tsx:27`). Wrapping the
test in four providers to render a header it makes no assertions about is the
wrong trade — the test is about the copy on the invite rows, which is what
stopped an owner revoking the wrong link (B97). Putting the chrome in the page
leaves `ContactsAdmin` renderable on its own and is where composition belongs
anyway. It also means the 130-line body of that component keeps its
indentation, so the diff is the change rather than a reflow.

Not doing: a bespoke "← back" link. A second navigation idiom on one page of ten
is how a site stops feeling like one site, and the header is what the other nine
pages taught the owner to use. Not adding `<PageHeader>` to the `NoticeShell`
branch either — that page is for somebody who is not signed in, and its single
action is already the right shape.

`main` gains `id="main"` and `tabIndex={-1}` so the skip link the header renders
has a target — `/me` is the precedent.

## Acceptance

- Signed in as the owner, `/<user>/contacts` shows the journal header, and
  clicking the journal title lands on the journal.
- The page still renders in the journal's own locale (the `lang={locale}` on
  `main` is unchanged), and the guest table, the invite panel and every button
  still work.
- Keyboard: tab once from the top reaches "skip to content" and it moves focus
  into the contacts `main`.
- `npm run build && npx tsc --noEmit && npx eslint . && npx vitest run` all pass.

## Verified

Against a locally built server with `auth`, `contacts` and `mail` on and a
SQLite `DATABASE_URL`, per `docs/running-locally.md`, signed in through the
real code flow as the example journal's owner:

```
GET /example/contacts             200
  <header …>                      present
  <a href="/example">Fernscout Demo</a>   the way back
  <a href="#main">Skip to content</a>     and its target:
  <main id="main" tabindex="-1" … lang="en">
```

With `contacts` off — the default — the same URL is `404` and the header is not
rendered at all, so the capability is still absent rather than a dead page.

`test/contacts-way-back.test.tsx` renders the page component itself, with the
layout's four providers around it: three tests, two of which fail on the code
as it was. Full suite 151 files / 2335 tests green; `npm run build`,
`npx tsc --noEmit` and `npx eslint .` clean (4 pre-existing warnings, none in
these files).

Not run: `claude-security`. The change adds chrome to a page already behind
`isOwner`, and touches no auth, token, grant, visibility or API-route code —
the header it mounts is the one every other page of the journal already
renders.
