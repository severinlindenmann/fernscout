---
id: B327
title: A buddy writes a day and can see it nowhere on the site, because every reading path gates drafts on ownership
type: ISSUE
priority: high
complexity: medium
area: entries, access, drafts, ui
found: "2026-09-04T20:34:41Z"
started: "2026-09-04T18:54:18Z"
session: cae3e4fb-d628-4a89-89b7-43a581bc7e71
claimed: "2026-09-04T18:54:18Z"
---

# B327 — A buddy writes a day and can see it nowhere on the site, because every reading path gates drafts on ownership

## Why

Asked for by the author, 2026-09-04, immediately after B320 shipped — and B320
is what makes it urgent rather than merely inconsistent.

**The codebase already holds two different answers to "who may see a draft",
and the narrower one is on the surface a person actually reads.**

The API's answer is *owner, or somebody on the trip*.
`app/api/v1/[user]/trips/[trip]/days/route.ts:69` reads with
`includeDrafts: true`, and its own comment says why: *"the gate above already
establishes the caller may see them: owner, or somebody on the trip."* That
gate is `mayWriteTrip` (`lib/api/auth.ts:108`), which honours a trip-scoped
token. B296 made this deliberate.

The site's answer is *the owner, and nobody else*. Every reading path passes
`includeDrafts: isOwner(user)` — nine call sites:

- `app/[user]/trips/[trip]/page.tsx:74,91`
- `app/[user]/trips/[trip]/day/[slug]/page.tsx:87,93`
- `app/[user]/trips/[trip]/gallery/page.tsx:56`
- `app/[user]/trips/[trip]/map/page.tsx:60`
- `app/[user]/(trip)/page.tsx:28`, `day/[slug]/page.tsx:82,88`,
  `gallery/page.tsx:49`, `map/page.tsx:79`
- `app/[user]/story.json/route.ts:62`

So the sequence B320 now invites is: Kevin is approved onto `asien-2025`, reads
his access page, hands the prompt to an agent, the agent writes a day — and
everything it writes lands as a draft, by design and on purpose (AGENTS.md).
Kevin then opens the trip on the site and **the day is not there.** Not on the
trip page, not at its own URL, not in the gallery, not on the map. His own
writing is invisible to him on every surface except an API call he is not going
to make by hand.

That is the worst shape this can fail in. Nothing errors, nothing refuses, and
the honest readings available to him are "the agent lied about writing it" or
"the site is broken". Neither is true. It is also precisely the failure B296
recorded from the agent's side — *"an agent checking whether its own write
landed sees nothing and reasonably concludes nothing happened"* — reappearing
one layer up, for the person instead of the machine.

The draft default is a courtesy and not a gate: AGENTS.md says so directly —
*"It is the default so that a person can read a day back before it is on the
site — a courtesy to them, not a gate against you."* A person who may write the
day and cannot read it back is the one case where that sentence is false.

## Work

Replace `isOwner(user)` with a resolver that answers the question the API
already answers: **may this viewer see this trip's drafts?** — owner, or
somebody holding a place on this trip. `isPersonOnWith` / `peopleOf` is the
same membership `resolveViewer` uses for `through: "traveller"`, and B320
established that it agrees with the server's `isPersonOn`.

One resolver, called from all nine sites. Not nine local conditions: B41 is the
record of what happens when two surfaces each work out access for themselves,
and this is the same shape with a worse blast radius, because getting it wrong
in the generous direction publishes somebody's unfinished writing.

**Four things that must hold, and each is a way this leaks.**

- **Per trip, never per journal.** Somebody on `asien-2025` sees that trip's
  drafts and nothing of `alps-2024`. A journal-wide answer would hand every
  buddy every unfinished day in the journal.
- **A guest of the journal sees no drafts at all.** Being let in to read is not
  being on the trip. `viewer.guest` is not the test; the trip place is.
- **The static paths.** Several of these pages are statically rendered and
  several are `force-dynamic`; check each. A draft that reaches a cached page
  is a draft served to everyone, and the failure would be silent.
- **`story.json`, the feed, the sitemap and search.** `story.json:62` is in the
  list above and must follow the same rule. The feed, the sitemap and the
  search index must **not** — a draft is not published, and appearing in a feed
  is publication. Check what each actually does rather than assuming.

**Say whose it is, on the page.** A draft rendered to a buddy has to be marked
as one, in the same way `test: true` is — a day nobody has put on the site yet,
visible to you because you were there. Without that, the difference between
"written" and "on the site" disappears for exactly the person who most needs to
know that publishing is somebody else's call (B28).

Not doing: any change to who may **publish**. That stays the owner's, and this
ticket must not become a route to it. Nor any change to the API, which already
does the right thing.

**Four things settled while building.**

*The caching worry was unfounded, and reading settled it rather than a change.*
`app/[user]/layout.tsx` reads cookies, which makes everything under `/[user]`
per-request; `trips/[trip]/layout.tsx` additionally declares `force-dynamic`
and says why (B100's sibling). The `generateStaticParams` exports that remain
are inert. No draft can reach a prerendered page.

*The feed, the sitemap, the search index and the structured data need no
change either.* `lib/feed.ts:72`, `app/sitemap.ts:67,97`, `lib/search.ts:36`
and `BlogStructuredData`'s `getAllEntries(trip.ref)` all read with no options,
so drafts are filtered for every viewer by the default. Verified rather than
assumed.

*`getPlan({ includeDrafts })` was deliberately widened, and its contract
changed.* It folds future-dated draft coordinates into the route, and its doc
said it "must only ever be called with `includeDrafts: true` for the trip's
owner — a reader must not learn where somebody is going next". Somebody on the
trip is not that reader: they are on the bus, and where it goes next is not a
secret from them. Both map pages now pass `drafts.visible`, and the comments
say so.

*The copy had to fork, which was not in the plan.* "Draft — only you can see
this … tell your agent to publish it when you are happy with it" is false to a
buddy in both halves, and the second half is the dangerous one: told they may
publish, they would send an agent after a call that refuses it, which is
B293's shape. So `DraftNotice` and the map's draft caption now choose on
`canPublish`, carried on `TripProvider` — the alternative was threading a
boolean through four components with no other reason to know who is reading.

Also captured, not absorbed: **B330**, `story.json` varies by cookie and sends
no `Vary`, so a browser cache on a shared device can serve one reader's view to
the next. It predates this ticket; what this ticket changes is how many people
have a view worth not leaking.

Consider whether the buddy's own access page should link the drafts waiting on
their trip — it is where they will look, and B320 built the block it would sit
in. Probably a follow-up rather than this ticket.

## Acceptance

- Signed in as somebody on a trip who does not own the journal, a draft day on
  that trip is visible: on the trip page, at its own URL, in the gallery and on
  the map.
- It is marked as not yet on the site, in words, wherever it appears.
- The same reader sees no draft from any other trip in the journal, including
  one they can otherwise read.
- A guest of the journal, and a signed-out reader, see no drafts anywhere —
  a test covers both, because this is the direction that leaks.
- No draft appears in the feed, the sitemap or the search index for any viewer.
- The owner's own view is unchanged.
- A test fails on `main` for the buddy case.
