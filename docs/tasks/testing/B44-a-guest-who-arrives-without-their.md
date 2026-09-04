---
id: B44
title: A guest who arrives without their link sees a complete-looking journal and no way to say who they are
type: ISSUE
priority: medium
complexity: medium
area: me, nav, access, i18n, ui
found: "2026-09-01"
started: "2026-09-03T19:24:37Z"
merged: "2026-09-04T04:37:32Z"
---

# B44 — A guest who arrives without their link sees a complete-looking journal and no way to say who they are

## Why

Somebody was invited to a journal. Months later they type the address, or
follow a bookmark, or tap the link in a message from somebody else — not the
one that was mailed to them. They land on `/example` with no cookie.

What they see is a journal. Public trips, a map, a gallery, a nav bar. It looks
finished. `listableTrips` (`lib/tripGate.ts:128`) has quietly removed
everything they were actually invited for, and correctly — listing a private
trip to an anonymous visitor is the leak the whole gate exists to prevent. But
the page gives no indication that a filter ran. There is no "you are reading
this as a visitor", no greeting, nothing in the chrome that ever says whether
anybody is signed in — `components/PageHeader.tsx` does not look at the viewer
at all. The reader's conclusion is not "I should sign in". It is **"they never
added me"**, or "this is the wrong journal", and then they close the tab.

The answer they need exists and is good. `/[user]/me` in its signed-out branch
shows `me.strangerTitle` — *"Du bist nicht angemeldet"* /
*"You are not signed in"* (`content/locales/de.json:300`,
`app/[user]/me/MePageContent.tsx:68`) — and, when the journal runs `auth`,
`GuestSignIn` underneath it: type your address, get a code and a one-tap link.
The docblock at `app/[user]/me/MePageContent.tsx:14–24` names the exact person
this task is about, the grandmother who opens the journal once a month and has
lost the email.

**She will never reach that page.** The only route to it is the person icon in
`components/SiteNav.tsx:87`, whose label is `hidden xl:inline`
(`SiteNav.tsx:99`) — as are every other nav label (`:64`, `:80`). Below 1280px,
which is every phone and most laptops, the nav is six unlabelled icons and the
door marked "Your access" is a small outline of a head. The `title` and
`aria-label` are right, and neither is visible to somebody looking at a phone.

So the site has a well-written answer on a page reachable only by a reader who
already knows to look for it — the same closed loop the comment at
`SiteNav.tsx:82–86` describes for `/join` and deliberately opened. This is that
bug again, one level up.

Three things to hold onto before designing a fix.

**The affordance must not depend on what is hidden.** "3 trips are not shown to
you" tells an anonymous prober that three private trips exist, on a journal
whose owner may not want the fact of them known. Whatever is shown must be
identical for a journal with ten hidden trips and a journal with none — an
invitation to identify yourself, never a report on what was filtered.

**Signing in may still not show them the trip.** `lib/tripGate.ts:116` says it
plainly: *"the only way to be a guest is to hold the trip's password"* — an
approved contact with a `read` grant is still not listed one. B35 and B41 are
in that gap and both are live. This task must not promise a door those tasks
have not finished building; check what a signed-in guest actually sees before
writing copy that says "sign in to see more".

**Not every journal can offer it.** `auth` and `contacts` are off by default
(`content/config.json`), and `me.askOwner` already exists for the journal that
has neither. A prompt that leads to a form that cannot work is worse than no
prompt — that exact bug is recorded in the comment at
`app/[user]/me/MePageContent.tsx:76–84`.

Related: B20 improves the copy on that same signed-out panel (it never names
who to ask). B39 replaces the trip password with the same email sign-in. This
task is only about a reader ever finding the panel.

## Work

The shape is a decision, not a detail, and the point of the task is to make it
deliberately. Two candidates worth weighing before code:

- **A labelled way in, always visible.** Give the `/me` link a visible text
  label at every width rather than from `xl` up — or move it out of the icon row
  into something that reads as a door. Cheapest, and fixes the discoverability
  problem for every reader including the one who is signed in and wants out.
- **A quiet line on the journal's own pages** — one sentence near the trip list
  saying this journal shows more to people it knows, with a link to `/me`.
  Constant text, present whether or not anything was filtered.

Whatever ships: shown only when the journal can actually act on it
(`isEnabled("auth")` or `contacts`), suppressed for a viewer who already has a
session, and suppressed for the owner. Copy goes in all three of
`content/locales/{en,de,hu}.json` plus the key union in `lib/i18n.ts`, and
`npm run i18n:keys` must pass.

**Not doing:** counting or hinting at hidden trips; a modal or interstitial in
front of the journal; changing what `listableTrips` returns; anything that
sends mail. Those are B35, B41 and B43.

### What was built, and where it differs from the above

The first candidate, with two decisions the sketch above did not make.

**It is the chrome, not a page.** The second candidate had nowhere to live:
the journal's front page is the story pager, a full-viewport component with no
prose column to put a sentence beside, and there is no site footer. The only
thing every page of a journal shares is `PageHeader` → `SiteNav`, which is also
where a reader looks for a way in. So the `/me` entry keeps its href and its
page and changes only how it is *drawn*: for a reader with no session on a
journal that runs `auth`, it becomes a bordered pill reading **"Sign in"**,
labelled at every width, and moves to the end of the row — an outlined pill
between two icon tabs reads as a broken tab; at the end of the row it reads as
a control. Every other reader gets exactly the icon they got before.

**Gated on `auth` alone, not on `auth` or `contacts`.** With `contacts` on and
`auth` off there is still no form behind that page — only `me.askOwner`, a line
saying to ask whoever writes the journal for a link. A control marked "Sign in"
leading to that is the bug recorded at `app/[user]/me/MePageContent.tsx:76–84`,
so the narrower gate is the honest one. This is stricter than the acceptance
line below asks for, not looser: a journal with both off shows nothing, and so
does a journal with only `contacts`.

The constant-ness the Why demands is structural rather than careful. The flag
is `SiteSummary.canSignIn`, resolved in `lib/site.ts` from `isEnabled("auth",
username)`, and `SiteNav` reads it and the session and nothing else. Neither
`siteSummaryFor` nor `SiteNav` is ever handed a trip list, so there is no value
in scope that could vary with what `listableTrips` removed — `test/access-door.test.ts`
pins the first and `test/site-nav.test.tsx` the second by rendering the nav for
a journal with two hidden trips and one with none and comparing the markup.

Two things found while measuring, both in a real browser at real widths:

- The nav now wraps (`flex-wrap justify-end`). At 320px, and in German at
  390px, seven entries no longer fit across the header's content box, and
  without wrapping the row overflowed its container *to the left* and pushed
  the first icon off the screen — while the document itself still reported no
  horizontal overflow, so nothing looked wrong from the outside.
- At exactly 1280, where the other five labels turn on, the journal's own title
  truncates. Pre-existing and made slightly better by this change, not worse
  (the nav is 27/5/55px narrower in en/de/hu than before). Captured as **B170**.

## Acceptance

- From a fresh browser with no cookies, on a 390px-wide viewport, a reader can
  get from the journal's front page to the sign-in form without knowing what
  the person icon means — demonstrated as a click path, not asserted.
- The rendered HTML and RSC payload for an anonymous viewer are byte-identical
  in this respect whether the journal has hidden trips or none: assert that no
  count, title, or id of an unlisted trip appears.
- A journal with `auth` and `contacts` both off shows no prompt that leads to a
  form it cannot serve.
- A signed-in guest and the owner are not shown the prompt.
- `npm run i18n:keys`, `npx tsc --noEmit`, `npx eslint .`, `npx vitest run` and
  `npm run build` all pass.
