---
id: B05
title: Entry tags are written everywhere and searched nowhere
type: FEATURE
priority: low
complexity: low
area: search, tags
found: "2026-09-01"
---

# B05 — Entry tags are written everywhere and searched nowhere

## Why

Four write paths put `tags:` into an entry, and they are the paths an agent
actually uses:

- `lib/api/entries.ts:115` — REST `POST /api/v1/<user>/trips/<trip>/days`
- `lib/mcp/tools.ts:440` — the `create_day` MCP tool, with `tags` in its schema
- `lib/ingest/entry.ts:113` — `ingest-photos --tags a,b`
- by hand, per the `add-a-day` skill, which lists `tags:` in its field list

Two read paths consume them: `lib/feed.ts:100` writes each one as an RSS
`<category>`, and the day's REST representation returns them
(`app/api/v1/[user]/trips/[trip]/days/[slug]/route.ts:58`).

Search is not one of them. `SEARCH_OPTIONS.fields` in `lib/searchOptions.ts`
is `["title", "location", "country", "tripTitle", "body"]`, and `buildDocs`
in `lib/search.ts:33` never puts `tags` on the document. Nothing renders them
either — there is no tag chip on a day and no way to ask for "everything
tagged X".

Measured against the demo journal, which is now tagged throughout:

| query | hits | entries actually carrying it as a tag |
| --- | --- | --- |
| `sleeper` | 0 | 1 |
| `wildlife` | 0 | 2 |
| `national-parks` | 18 | 11 |

The first two are the plain miss: neither word appears in the prose of the
entry that is tagged with it, so the tag is the only place the information
exists and search cannot see it. The third is the subtler one — 18 hits for a
tag on 11 entries, because the parks trip's *title* contains "parks" and
`tripTitle` is indexed. So the tag is contributing neither recall nor
precision; the number just happens to look plausible.

This is a gap between what the field promises and what it does, not a bug.
Nothing is broken today, and an author who never writes a tag loses nothing.

## Work

1. Add `tags: string[]` to `SearchDoc` and populate it in `buildDocs`.
2. Add `"tags"` to `SEARCH_OPTIONS.fields`. Consider a boost — a tag is a
   deliberate label and is worth more than an incidental mention in prose,
   which is the same argument `title` would make.
3. Decide whether tags go in `storeFields`. They are short, so the payload
   argument in the `SearchDoc` docstring does not bite the way `body` does —
   but only store them if something is going to render them.
4. Optional, and a separate decision: a tag chip on a day, and
   `/<user>/search?tag=…`. Do not do this by accident while doing 1–3.

`SEARCH_OPTIONS` is shared between the build-time index and the browser that
loads it with `MiniSearch.loadJSON`, so `fields` and `storeFields` must change
in exactly one place — which is why that file exists. A mismatch is a silently
wrong index, not an error.

## Acceptance

- Searching `sleeper` finds the night-train entry; searching `wildlife` finds
  the two parks entries. Both return 0 today.
- `/<user>/search-index.json` still prerenders, and `components/SearchBox.tsx`
  loads it without a MiniSearch options mismatch.
- The index does not grow disproportionately — check the byte size of
  `example/search-index.json` before and after.
- Drafts stay out. `buildDocs` filters through `getAllEntries` without
  `includeDrafts`, and tagging must not become a second way in.
