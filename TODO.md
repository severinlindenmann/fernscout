# TODO

Not live yet. This is what stands between the current state and a real
deployment, plus the known problems that were measured but deliberately left.

Last updated: 2026-08-30 · measured at HEAD `2dfa6e0` + uncommitted work.

---

## 1. Before it goes live

### Replace the simulated content

Everything currently on the site is placeholder data written to exercise the
layouts. All of it has to go.

- [ ] `content/entries/*.md` — 13 demo updates across 12 days
- [ ] `public/media/*` — 26 placeholder photos (2.7 MB)
- [ ] `content/plan.md` — the 18-stop route is invented; replace with the real plan
- [ ] `content/costs.md` — both the `budget:` block (32'000 / 165 days) and the preparation items
- [ ] `lib/site.ts` — check the tagline and `startLocation` still read true

### Server environment

| Variable | Needed for | If missing |
| --- | --- | --- |
| `NEXT_PUBLIC_SITE_URL` | absolute share/preview links, notification URLs | links point at `https://example.com` |
| `DATA_DIR` | reactions + push subscriptions | falls back to `.data/` **inside the repo** — a rebuild can wipe it |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | push notifications | opt-in renders nothing (safe, just absent) |

- [ ] Point `DATA_DIR` somewhere like `/var/lib/fernscout`, outside the repo
- [ ] `npm run notify -- --generate-keys` once, store the private key properly
- [ ] Back up `$DATA_DIR` — it is the only state not in git, and it is not recoverable
- [ ] Run under pm2 in **fork** mode, not cluster — the write queue in `lib/store.ts` is per-process

### TLS

- [ ] nginx + a certificate before anything else works: service workers refuse
      to register on plain HTTP anywhere except `localhost`, so **no PWA and no
      push until HTTPS is live**

### Verify after the first deploy

- [ ] Install to an iPhone Home Screen, enable notifications, send one with
      `npm run notify -- --latest`. This is the only path that cannot be
      tested locally, and iOS is the fussiest target.
- [ ] React to a day from a phone, then check `$DATA_DIR/reactions.json`
- [ ] Confirm `robots.txt`, `sitemap.xml` and an OG preview all resolve against
      the real domain

---

## 2. Known problems, measured but not fixed

Ranked by what actually bites first.

### SCALE-1 — the home page grows with the trip

`buildSteps(days)` serialises every day's markdown, gallery and cost items into
one client component tree, so the reader downloads the whole trip before seeing
day one.

> **Measured:** 148 KB of HTML for 13 days = ~11.4 KB/day → **~2 MB at 180 days.**

Invisible today, unavoidable later. Fixing it after the trip starts means
migrating live data over hotel wifi.

- [ ] Pass only a window of days around `stepIndex` into the client tree, and
      fetch neighbours on demand. The `/day/<slug>` routes already exist as the
      server-side source, so the data path is there.

### OPS-1 — photos in git, at full size

2.7 MB for 26 demo files. Real phone photos are 3–6 MB each and a five-month
trip is thousands of them. Committed, that makes the repo unclonable and every
deploy a full re-transfer.

- [ ] Media out of git — `rsync` to the VPS, or object storage
- [ ] Resize at ingest so nothing over ~2000px wide is ever served

### The ingest script (the one that decides whether this survives the trip)

Writing frontmatter by hand from a hostel at midnight is how a travel blog
quietly dies in month two.

- [ ] `npm run ingest -- <folder>`: a folder of photos + a text file becomes a
      dated entry — images resized, EXIF read for coordinates and timestamp,
      frontmatter written, media moved into place

### PERF-1 — nothing is route-split

All five routes ship the same 294 KB of JS. `lib/worldLand.json` (62 KB of baked
path data) is a static import in three client components, so the world outline
is downloaded on `/costs`, where no map is drawn.

- [ ] Dynamic `import()` for the land data inside the map components
- [x] `next/dynamic` for `SlideShow` — it's behind a button, nobody should pay
      for it until they press it (W19)

### J4 — what the PWA still cannot do on a bad connection

The service worker was rewritten in W17: navigations are network-first with a
4s timeout (a stalled mobile connection hangs rather than fails, and hanging in
front of a page we already hold is the worst outcome available), `.json` is
stale-while-revalidate so the story pager's day windows stop being cached
forever, the fallback chain is exact page → any page from the same journal →
`/offline`, and the runtime cache is capped at 300 entries. Verified in a
browser with the server killed mid-session.

What is left, and why it was not cheap:

- **The runtime cache is trimmed by insertion order, not by use.** On a
  five-month trip that evicts the oldest cached days first, which is the right
  guess but only a guess. A real LRU needs timestamps the Cache API does not
  keep, so it means a parallel index in IndexedDB.
- **Photographs are cached at full size.** OPS-1 above is the actual fix:
  resize at ingest. No amount of caching strategy rescues a 4 MB JPEG on 3G.
- **Nothing is precached for a journal.** The worker is installed from
  whichever page the reader happened to open and has no idea whose journal it
  is about to serve, so the first day of a trip is always a cold fetch. Fixing
  it means the page telling the worker what to warm, i.e. a message channel and
  a per-user manifest.
- **`lib/feed.ts` stamps RSS `pubDate` by treating the author's local date as
  UTC.** Up to ~14 hours out, and some aggregators hide future-dated items. The
  honest fix needs a `timezone:` on the trip, which is a frontmatter change.

### TEST-1 — no tests

Every regression so far was caught by hand: dropped cost data, the hydration
mismatch, the direction-guard bug, the orphaned `dt`/`dd`.

- [ ] Unit tests over `lib/entries.ts` and `lib/costs.ts` parsing/aggregation —
      the frontmatter parsers have real logic and degrade silently on a typo
- [ ] One Playwright pass that walks the pager and runs axe on each route

---

## 3. Polish

- [ ] **Swipe navigation on mobile.** The reading model is one screen at a time,
      which is exactly the model people swipe; right now the only way forward on
      a phone is the button. `motion` is already a dependency — `drag="x"` plus
      a threshold, wired to the same `goStep` the buttons call.
- [ ] **The overview reads as five identical cards.** Masthead, map, stats,
      spend, countries — all `rounded-2xl border-navy-200 shadow-sm`, same
      rhythm. Let the map bleed without its border, drop the card chrome from
      the two chart sections. The six-item stat grid also orphans one tile on a
      two-column phone layout.
- [x] **`navy-500` carries too many jobs** — split by job in W17. `navy-600`
      (#44546c, 7.69:1 on white / 7.00:1 on cream-100) now carries every piece
      of text; `navy-500` is borders, rules and decorative icons only.
      `test/contrast.test.ts` reads the tokens out of `globals.css` and fails
      if either of those stops being true.
- [ ] **The top bar takes two rows on a phone.** Once every control is 44px
      tall, six navigation icons plus the currency, language and trip chips
      plus the journal title need 373px and have 343px, so W17 wrapped them
      onto a second line — 121px of sticky header instead of 61px. The real
      fix is a mobile menu behind one button, which is a design decision rather
      than a contrast fix. Until then the six icons are 36px wide (44 tall),
      which meets WCAG 2.2's 24px minimum but not the 44px this audience wants.
- [ ] **Focus ring fades in over 150ms.** Tailwind's `.transition-colors`
      includes `outline-color`, so the ring animates instead of appearing.
      Correct but not snappy; suppressing it means overriding
      `transition-property` on focused elements, which has side effects.

---

## 4. Decisions to make, not tasks

- **Locales are not in the URL.** All three languages share one set of URLs, so
  German and Hungarian can't be linked or shared and search engines only see
  English. `/[locale]/…` routes with `hreflang` would fix it but touch every
  route. Worth doing only if the translations actually matter — otherwise
  consider dropping them rather than maintaining text nobody can reach.
- **"Since you last visited" counts by entry date, not publish date.** Backdating
  an entry won't announce it. Fine if days are written up roughly in order;
  needs a separate `published:` field if not.
- **Reaction storage grows as `days × voters`.** Fine at family scale (180 days ×
  50 readers ≈ 9k entries, a few hundred KB). If it ever gets shared widely,
  that JSON file is the first thing to reconsider.

---

## 5. Ideas, unprioritised

- [ ] RSS feed — nearly free given the existing sitemap generation, and family
      won't check a bookmark daily for five months
- [ ] "4 new days since you were here" already exists on the overview; an email
      digest would reach the people who won't install a PWA
- [ ] Full-text search across entries — at 13 days the path is enough, at 180
      "where was that waterfall" needs an index built at build time
- [ ] Costs: a budget line already lands on the cumulative chart; a per-country
      budget would be the next useful cut
- [ ] Guestbook — reactions cover the cheap version; free text needs moderation
      thought before it's worth it
