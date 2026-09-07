---
id: B879
title: Nothing points a crawler or an agent at the product pages, the feed or the markdown
type: FEATURE
priority: medium
complexity: low
area: SEO / discovery
found: "2026-09-07T17:49:59Z"
started: "2026-09-07T17:50:38Z"
session: d84a547d-0f51-4bfa-8a57-66c4c87decf4
claimed: "2026-09-07T17:50:38Z"
---

# B879 — Nothing points a crawler or an agent at the product pages, the feed or the markdown

## Why

The journal pages are well covered — `metadataBase`, per-page canonicals,
hreflang, JSON-LD, per-day OG images, `robots` that noindex a locked trip. The
gaps are all in what is *not* a journal page, and in what a machine reader is
told exists.

1. **`app/sitemap.ts` lists journal pages and nothing else.** It loops
   `listedUsernames()` and stops, so the live sitemap is 84 URLs of which every
   one belongs to somebody's trip. `/` itself, `/docs`, the three
   `/docs/guide/<guide>` pages and `/agent` are in no sitemap at all. Those are
   the pages that answer "what is this software" — the ones a search engine
   should be offered first, and the only ones on the instance that are about
   the product rather than about a journey.

2. **`feed.xml` is undiscoverable.** `app/[user]/feed.xml/route.ts` serves a
   real feed per journal and nothing in the document head points at it. A
   reader's feed client, and every crawler that looks for `rel="alternate"`,
   sees a journal with no feed.

3. **`/agent.md` is announced nowhere.** It is the whole guide for an agent
   working over the network (`AGENTS.md`, decision 24), and an agent handed a
   journal URL has to already know the convention to find it. Same for the
   day's own markdown twin at `/<user>/day/<slug>.md`: it exists, and the HTML
   page it mirrors does not say so.

   This is deliberately *not* `/llms.txt` — `app/documentation.txt/route.ts`
   says in as many words that the off-convention name is what keeps drive-by
   probes off the instance. A `rel="alternate"` link is discovery for anybody
   already holding the URL, which is the case that matters, without publishing
   a well-known path to be harvested.

4. **`blindreader-a11y` is advertised to Google.** It is an accessibility test
   journal and it is in the live sitemap beside the real ones, because its
   config asks to be listed. Its content is not a journey anyone took.

## Work

- `app/sitemap.ts`: emit the instance's own pages ahead of the journals — `/`,
  `/docs`, `/docs/guide/<g>` for each of `GUIDES`, and `/agent`. Take the
  guide list from `lib/docs.ts` rather than typing it out, the same rule the
  contract tests apply to enums. Gate `/agent` on the helper capability if it
  can be off, so the sitemap never offers a 404.
- `app/[user]/layout.tsx`: add `alternates.types` to the journal metadata —
  `application/rss+xml` → `/<user>/feed.xml`, `text/markdown` → `/agent.md`.
- The two day pages (`app/[user]/(trip)/day/[slug]/page.tsx` and
  `app/[user]/trips/[trip]/day/[slug]/page.tsx`): `alternates.types` with
  `text/markdown` → that day's own `.md` URL. Both, because they render the
  same day at two paths.
- `content/blindreader-a11y/config.json`: `visibility: guest`, so the journal
  keeps working and stops being advertised. `listedUsernames()` already drops
  it on that value.

Not doing: `/llms.txt` (see Why), a `.well-known/` discovery document, a
per-day `opengraph-image` route, or an MCP endpoint. The last is a real piece
of work and belongs in its own ticket, not smuggled in here.

## Acceptance

- `curl -s <url>/sitemap.xml | grep -c '<loc>'` includes `/`, `/docs`, each
  `/docs/guide/*` and `/agent`, and every one of them answers 200.
- `blindreader-a11y` appears in no `<loc>` of the sitemap, and
  `/blindreader-a11y` still renders for somebody who opens it.
- A journal page's HTML carries
  `<link rel="alternate" type="application/rss+xml" href=".../feed.xml">` and
  `<link rel="alternate" type="text/markdown" href="/agent.md">`.
- A day page carries `<link rel="alternate" type="text/markdown">` pointing at
  a URL that answers 200 with that day's source, from both of its paths.
- `npm run verify` passes.
