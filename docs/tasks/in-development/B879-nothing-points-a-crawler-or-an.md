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
   `/docs/guide/<guide>` pages and the four technical ones under `/docs` are
   in no sitemap at all. Those are the pages that answer "what is this
   software" — the ones a search engine should be offered first, and the only
   ones on the instance that are about the product rather than about a
   journey. (`/agent` is not among them: `app/agent/page.tsx` sets
   `robots: { index: false, follow: false }` because signed in it names the
   reader's own journal, so offering it in a sitemap would contradict the
   page. Found while building; the first draft of this ticket had it wrong.)

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
  `/docs`, and every `href` in `DOCS_PAGES`. Read that constant from
  `lib/docs.ts` rather than typing the list out, the same rule the contract
  tests apply to enums: it is already the list the hub and the inner nav both
  render, so a page added there is a page the sitemap gains for free.
- `app/[user]/layout.tsx`: add `alternates.types` to the journal metadata —
  `application/rss+xml` → `/<user>/feed.xml`, `text/markdown` → `/agent.md`.
- The two day pages (`app/[user]/(trip)/day/[slug]/page.tsx` and
  `app/[user]/trips/[trip]/day/[slug]/page.tsx`): `alternates.types` with
  `text/markdown` → that day's own `.md` URL. Both, because they render the
  same day at two paths.
- `blindreader-a11y` is **not in this repository** — the checkout's `content/`
  holds only `example`, and that journal exists in the deployed instance's own
  `CONTENT_DIR`. So it is an edit on the server, not a diff here:
  `visibility: "guest"` in its `config.json`, which `listedUsernames()`
  already drops. Recorded here so it is not lost; it is the operator's file.

Not doing: `/llms.txt` (see Why), a `.well-known/` discovery document, a
per-day `opengraph-image` route, or an MCP endpoint. The last is a real piece
of work and belongs in its own ticket, not smuggled in here.

## Acceptance

- The sitemap's `<loc>` list includes `/`, `/docs` and every `DOCS_PAGES`
  href, and each of them answers 200.
- After the operator's config edit, `blindreader-a11y` appears in no `<loc>`
  of the live sitemap, and `/blindreader-a11y` still renders for somebody who
  opens it.
- A journal page's HTML carries
  `<link rel="alternate" type="application/rss+xml" href=".../feed.xml">` and
  `<link rel="alternate" type="text/markdown" href="/agent.md">`.
- A day page carries `<link rel="alternate" type="text/markdown">` pointing at
  a URL that answers 200 with that day's source, from both of its paths.
- `npm run verify` passes — build, `tsc`, `eslint` and the 4860-test suite.
  Its last step, `npm run unused`, fails on an export this diff does not
  touch and which fails identically on a clean `main`; captured as B882 and
  not absorbed here.
