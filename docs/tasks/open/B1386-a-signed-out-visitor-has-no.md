---
id: B1386
title: A signed-out visitor has no way to get a journal of their own
priority: medium
type: FEATURE
complexity: low
area: helper, signup, landing
found: "2026-09-10T19:16:01Z"
---

# B1386 — A signed-out visitor has no way to get a journal of their own

## Why

The one thing `/<user>/me` offers a reader with no session is a link to the
guest guide:

```
app/[user]/me/MePageContent.tsx:1089–1097
  <Link href={`/docs/guide/${viewer.owner ? "creator" : … : "guest"}`}>
    {t("guides.readMore")}      // "Neu hier? Lies die Anleitung"
  </Link>
```

"Neu hier?" is exactly the question somebody in that position is asking, and
the answer it gives them is a document. Somebody who has just read a friend's
travel journal and wants one of their own is at the most receptive moment they
will ever be at, and the page sends them to reading material instead. There is
no route from here to a journal of their own at all — they would have to work
out on their own that the landing page exists and that signup starts there.

The landing page already has the words for it: `landing.heroKicker` **"Dein
eigenes Reisetagebuch"** over `landing.hero` **"Ein Reisetagebuch, das dein
Agent für dich schreibt."**

## Work

For a reader with no session, replace the guide link with a "new account" call
to action, worded from the landing hero, going **straight to signup** rather
than to the landing page — the author's call; a visitor who has already decided
should not be shown the pitch again.

Owner and buddy keep the guide link they have now; nothing about their view
changes.

New locale keys in `en`, `de` and `hu` — real German and real Hungarian, and
`npm run i18n:keys` after adding them.

Where signup is switched off for the instance, fall back to the guide link as
it is today rather than offering a door that does not open — `agent.signupOff`
exists and says as much.

Not in scope: the `agent.startTitle` "Neu hier?" box on `/agent` itself, which
is already a signup entry and works.

B1385 is on the same page and the same reader distinction; the two may want
building together.

## Acceptance

- Signed out, `/<user>/me` offers a "your own travel journal" link that lands on
  the signup flow, not on `/docs/guide/guest`.
- Signed in as owner: the creator guide link, unchanged.
- On a trip's `people:`: the buddy guide link, unchanged.
- With signup disabled for the instance: the guest guide link, as today.
- Every new key present in all three locales, in the language it claims to be.
- `npm run verify` passes.
