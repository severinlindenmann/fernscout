# How it is put together

For somebody reading the source for the first time: where things live, and the
handful of decisions that explain the shape of everything else.

## The two halves

**Content is files.** `content/<username>/trips/<trip-id>/` holds `trip.md`,
`entries/*.md`, optional `costs.md` and `plan.md`, and `media/`. That is the
source of truth; nothing is authoritative in the database.

**The database is an index and a session store** — accounts, contacts, guest
grants, push subscriptions, reactions, jobs. SQLite locally, Postgres in
production, and nothing outside `lib/db/` and `lib/repos/` knows which.

A trip is addressed as a **ref**, `<username>/<trip-id>`; ids are unique per
user, not per instance. Use `tripRef()` / `parseTripRef()` in `lib/trips.ts`
rather than string concatenation — a username is a directory name, so it is a
security boundary.

## The URL space

Everything a person owns hangs off `/<username>`. `app/[user]/(trip)/…` serves
that journal's *current* trip at the short URL; `app/[user]/trips/[trip]/…`
serves any trip at the explicit one. Both render the same components.

| | |
| --- | --- |
| `/<user>`, `/<user>/day/<slug>` | the story — overview, then one day per screen |
| `/<user>/costs` · `/gallery` · `/map` | the other views of one trip |
| `/<user>/trips` | every trip, with the lifetime map |
| `/<user>/search` | across the whole journal, not one trip |
| `/<user>/me` · `/contacts` · `/join` | the reader's own access, and getting it |
| `/<user>/i/<token>` · `/c/<token>` · `/u/<token>` | invite, confirm, unsubscribe |
| `/<user>/feed.xml` · `/search-index.json` · `/story.json` · `/export.zip` | generated |
| `/<user>/media/<path>` | media, resized on demand and cached |

## Server-side modules

| | |
| --- | --- |
| `lib/entries.ts` | parses entry markdown, groups into days and places, computes stats. **Every reading path filters `status: draft` here.** |
| `lib/trips.ts` · `lib/users.ts` · `lib/config.ts` | the content tree: who exists, what they have, what they configured |
| `lib/access.ts` · `lib/viewer.ts` · `lib/tripGate.ts` | who may see a trip, and what a given viewer is allowed |
| `lib/auth/` | email OTP, sessions, and agent tokens — two classes that are never interchangeable |
| `lib/db/` · `lib/repos/` | the dialect split, migrations, and one repo per stored thing |
| `lib/api/` · `lib/mcp/` | the REST surface under `/api/v1` and the MCP server at `/api/mcp`, over one shared core |
| `lib/validate/` | what an agent may write, and why a rejection says what it says |
| `lib/media.ts` · `lib/mediaSizes.ts` · `lib/mediaLimits.ts` | derivatives, quotas and upload ceilings |
| `lib/ingest/` | a folder of camera files → EXIF, clustering, resizing, entry markdown |
| `lib/mail/` · `lib/digest/` · `lib/push.ts` | reaching readers: `.eml` files or SMTP, the nightly digest, web push |
| `lib/contacts/` | one contact record behind invites, digests and postal addresses |
| `lib/photobook/` · `lib/postcard/` | PDF generation, with a `dry-run` backend for every provider |
| `lib/capabilities.ts` | which optional features are on, and why one is off — see `/api/health` |

Money and locale each split into a **pure half a client component may import**
and a **server-only half that reads files**: `lib/costFormat.ts` / `lib/costs.ts`,
`lib/currency.ts` / `lib/rates.ts`, `lib/reactionSet.ts` / `lib/reactions.ts`.

## The reading components

- `app/TripStory.tsx` — the shell: header, day bar, path sidebar, pager.
- `components/StoryPager.tsx` — one screen at a time: hero, then for each day
  its travel leg (if any) and its card.
- `components/PagerNav.tsx` — Back / position / Continue. Stands alone on
  desktop; folded into the mobile bottom bar so there aren't two stacked bars.
- `components/TravelScene.tsx` + `Travelers.tsx` + `Cityscape.tsx` — the
  between-days animation. Skylines are drawn procedurally, seeded from the
  location name, so each city looks its own but stays consistent.
- `components/GamePath.tsx` — the winding day path, with country flags.
- `components/WorldMap.tsx` · `MiniMap.tsx` · `SlideShow.tsx` ·
  `charts/Charts.tsx` — the map, the hero's "we are here", the fullscreen
  slideshow, and the `/costs` chart primitives.
- `public/sw.js` — service worker: offline shell plus push handling.

Only a window of days around the current one is passed into the client tree;
the rest arrive from `story.json` on demand. That is deliberate — serialising a
five-month trip into one tree was measured at ~2 MB of HTML.

## Languages

**English, German and Hungarian**, switchable from the header. The choice is
remembered in the `fs.locale` **cookie**, so the server renders the right
language on the first request rather than after hydration. Appending `?lang=de`
to any URL sets it — that is the shareable form. Entry text is translated when
an entry provides `translations.de` / `translations.hu`, and falls back to the
original otherwise.

Dates are formatted from per-locale month/weekday tables rather than
`toLocaleDateString`, whose output differs between the server and the visitor's
browser and caused a hydration mismatch.

*Trade-off:* the locale is a cookie plus an optional `?lang=` (set in
`proxy.ts`), not a path segment, so all three languages share one set of URLs.
`app/sitemap.ts` emits `hreflang` so a crawler still learns they are
translations rather than duplicates.

## Reading model: paged, not scrolled

The story is **paged**. Each day is its own screen, each travel leg is its own
screen, and you move with Back / Continue (or ← / →).

It began as one long scrolling feed and that fought the reader: the sidebar's
`scrollIntoView` moved the *window* as well as itself, so the page kept yanking
back; the active-day band flickered between neighbours; and CSS `scroll-snap`
couldn't settle because the pinned travel scenes were far taller than the
viewport (measured: it landed on the intended card 1 time in 12). Paging deletes
that whole class of problem instead of patching it — there is one thing on
screen and one way forward.

## The travel animation

`TravelScene.tsx` plays a leg on its own screen over ~6s: we head off, the
vehicle crosses (flights arc up and back down), and the destination skyline
rises into view. The button reads **Skip** while it plays and **Continue** once
it's done. The vehicle is the [Lucide](https://lucide.dev) icon matching
`transportMode`. Respects `prefers-reduced-motion`.

## The world map

`scripts/build-world-map.mjs` bakes a simplified land outline into
`lib/worldLand.json` as SVG path data — a one-off step, so `world-atlas` and
`topojson-client` stay devDependencies and nothing map-related ships to the
browser but static JSON. No tile server, no API key. It is loaded through
`components/useWorldLand.ts`, which imports it dynamically so `/costs` doesn't
pay for a map it never draws. Re-run with `npm run build:worldmap`.

## Icon, SEO and design system

`app/icon.svg` is the favicon — the *Wanderweg* waymark. A PNG apple-touch icon
and a 1200×630 share card are generated at build time from the same shape, and
`app/favicon.ico` wraps a 32px render for browsers that still ask. See
[`docs/branding/BRAND.md`](branding/BRAND.md).

`robots.txt`, `sitemap.xml` and the web manifest are generated from the entries,
so new days appear automatically. Day permalinks carry article metadata and
JSON-LD. **Set `NEXT_PUBLIC_SITE_URL`** so absolute URLs point at the real
domain rather than the placeholder.

`app/globals.css` defines the palette (`cream` / `sky` / `yellow` / `green` /
`coral` / `navy`) — deliberately not default Tailwind slate/indigo. Fonts are
self-hosted via `next/font/google`: **Fredoka** for display, **Plus Jakarta
Sans** for body. `test/contrast.test.ts` reads the tokens back out of the CSS
and fails if a text colour stops clearing its contrast floor.
