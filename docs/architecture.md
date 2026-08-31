# How it is put together

For somebody reading the source for the first time: where things live, and the
handful of decisions that explain the shape of everything else.

## Layout / architecture

- `app/TripStory.tsx` — the shell: header, day bar, path sidebar, pager.
- `components/StoryPager.tsx` — one screen at a time: hero, then for each day
  its travel leg (if any) and its card.
- `components/PagerNav.tsx` — Back / position / Continue. Stands alone on
  desktop; folded into the mobile bottom bar so there aren't two stacked bars.
- `components/TravelScene.tsx` — the between-days animation (below).
- `components/Travelers.tsx` — the traveller figures in the animation. Hair
  and skin tones live in the `HIM` / `HER` constants at the top — tweak them
  there.
- `components/Cityscape.tsx` — procedurally drawn skylines, seeded from the
  location name so each city looks its own but stays consistent.
- `components/GamePath.tsx` — the winding day path, with country flags and a
  badge when a day has several updates.
- `components/WorldMap.tsx` — the map, with clustering, pan and zoom.
- `components/MiniMap.tsx` — the small "we are here" map in the hero.
- `components/SlideShow.tsx` — the fullscreen slideshow.
- `components/charts/Charts.tsx` — the chart primitives used on `/costs`.
- `lib/entries.ts` — parses the markdown, groups entries into days and places,
  and computes trip stats.
- `lib/flags.ts` — country name → flag emoji.
- `lib/costFormat.ts` — cost types, category colours and money formatting;
  pure, so client components can import it. `lib/costs.ts` is the server-only
  half that reads the markdown and aggregates.
- `lib/currency.ts` — rate tables, the two conversion hops and `formatMoney`;
  pure. `lib/rates.ts` is the server-only half that reads the cached ECB
  snapshot and builds the reader's currency list.
- `components/CurrencyProvider.tsx` + `CurrencySwitcher.tsx` — the reader's
  display currency, mirroring `LocaleProvider` / `LocaleSwitcher`.
- `scripts/update-rates.mjs` — `npm run rates:update`; refreshes the cached ECB
  rates. Never part of the build.
- `lib/i18n.ts` + `components/LocaleProvider.tsx` — translations (below).
- `lib/store.ts` — the atomic JSON store; `lib/reactions.ts` and `lib/push.ts`
  are the two things that use it. `lib/reactionSet.ts` is the pure half, so
  client components can import the emoji list.
- `lib/plan.ts` — reads a trip's `plan.md` and works out which stops we've
  reached.
- `components/DayReactions.tsx` + `ReactionsProvider.tsx` — the reaction row,
  with every day's counts fetched in one request rather than one per day.
- `components/PushOptIn.tsx` — the notification opt-in, iOS-aware.
- `public/sw.js` — service worker: offline shell plus push handling.
- `scripts/notify.mts` — the send-a-notification CLI (`npm run notify`).

### Languages

The interface is available in **English, German and Hungarian**, switchable
from the header. The choice is remembered in the `fs.locale` **cookie**, so the
server renders the right language on the first request rather than after
hydration. Appending `?lang=de` to any URL sets it — that is the shareable
form, and it applies to the page it arrives on. Entry text is translated when
an entry provides `translations.de` / `translations.hu`, and falls back to the
original otherwise.

Dates are formatted from per-locale month/weekday tables rather than
`toLocaleDateString`, whose output differs between the server and the
visitor's browser and caused a hydration mismatch.

*Trade-off:* the locale is a cookie plus an optional `?lang=`, not a path
segment, so all three languages share one set of URLs and search engines index
one of them. For a personal travel journal that's the right call; if the
translations should be indexed separately, this would need `/[locale]/…`
routes.

### Reading model: paged, not scrolled

The story is **paged**. Each day is its own screen, each travel leg is its own
screen, and you move with Back / Continue (or ← / →).

It began as one long scrolling feed and that fought the reader: the sidebar's
`scrollIntoView` moved the *window* as well as itself, so the page kept
yanking back; the active-day band flickered between neighbours; and CSS
`scroll-snap` couldn't settle because the pinned travel scenes were far taller
than the viewport (measured: it landed on the intended card 1 time in 12).
Paging deletes that whole class of problem instead of patching it — there is
one thing on screen and one way forward.

### The travel animation

`TravelScene.tsx` plays a leg on its own screen over ~6s: we head off, the
vehicle crosses (flights arc up and back down), and the destination skyline
rises into view, with a progress bar along the bottom. The button reads
**Skip** while it plays and **Continue** once it's done, so you can either
wait for it or move on. The vehicle is the [Lucide](https://lucide.dev) icon
matching `transportMode`. Respects `prefers-reduced-motion`.

### The world map

`scripts/build-world-map.mjs` bakes a simplified land outline into
`lib/worldLand.json` as SVG path data — a one-off step, so `world-atlas` and
`topojson-client` stay devDependencies and nothing map-related ships to the
browser but static JSON. No tile server, no API key. Re-run with
`npm run build:worldmap`.

### Icon & SEO

`app/icon.svg` is the favicon — the *Wanderweg* waymark: a bent trail, a yellow
lozenge on it, a green dot further along. A PNG apple-touch icon and a 1200x630
share card are generated at build time from the same shape, and
`app/favicon.ico` wraps a 32px render of it for browsers that still ask.
See [`docs/branding/BRAND.md`](docs/branding/BRAND.md).
`robots.txt`, `sitemap.xml` and the web manifest are generated from the
entries, so new days appear automatically. Day permalinks carry article
metadata and JSON-LD. **Set `NEXT_PUBLIC_SITE_URL` on the VPS** so absolute
URLs point at the real domain rather than the placeholder.

### Design system

`app/globals.css` defines a bright palette (`cream` / `sky` / `yellow` /
`green` / `coral` / `navy`) — deliberately not default Tailwind slate/indigo.
Fonts are self-hosted via `next/font/google`: **Fredoka** for display,
**Plus Jakarta Sans** for body.
