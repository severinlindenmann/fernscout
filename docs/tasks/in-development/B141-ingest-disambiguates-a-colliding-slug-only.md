---
id: B141
title: Ingest disambiguates a colliding slug only within one date, so two days can still shadow each other
type: ISSUE
priority: medium
complexity: low
area: ingest, slugs
found: "2026-09-03"
started: "2026-09-03T19:40:39Z"
session: d6791268-ed45-4a69-acde-99f9e5f10516
claimed: "2026-09-03T19:40:39Z"
---

# B141 — Ingest disambiguates a colliding slug only within one date, so two days can still shadow each other

## Why

Found while building **B119**, which closed this hole in the two network doors
and left it open in the third.

A slug is a day's address inside its trip — `getEntryBySlug` (`lib/entries.ts`)
takes the first match and has no tiebreak — so two entry files whose names
differ only in the date prefix produce one reachable day and one that is on
disk, is not a draft, and can never be served. B119 made `createDraft` refuse
that, which covers REST and MCP because both write through it.

`scripts/ingest.mts` does not. It has its own naming loop
(`lib/ingest/index.ts:483–490`) and it already knows collisions are possible:

```ts
let slug = baseSlug;
if (usedSlugs.has(`${cluster.date}/${slug}`)) slug = `${baseSlug}-${partOfDay(hour)}`;
for (let n = 2; usedSlugs.has(`${cluster.date}/${slug}`); n++) slug = `${baseSlug}-${n}`;
usedSlugs.add(`${cluster.date}/${slug}`);
```

The key is `${cluster.date}/${slug}`. So two stops in the same town on the same
day are correctly given `hoi-an` and `hoi-an-afternoon` — and the same town on
**two different days** is given `hoi-an` twice, which is the shadow.

Reaching it needs nothing unusual: a card holding two visits to one place a few
days apart, which is what a return leg or a base town looks like. The reverse
geocoder names both clusters the same thing, and `slugify` is deterministic.

It is not the same fix as B119's. Ingest cannot refuse — it is a batch import
of a folder somebody just handed over, and stopping the run because photograph
340 landed in a town visited on Tuesday would be worse than the bug. Ingest
also *deliberately joins* an existing entry for the same date: that is how "I
found six more photos from Tuesday" works, and the comment above the loop says
so. So the answer here is a wider `usedSlugs`, not a refusal.

## Work

Seed `usedSlugs` from the entry files already on disk, and key it on the slug
alone rather than on `date/slug` — with one exception, which is the whole
subtlety: a slug held by an entry on **this same date** is the join case and
must stay available, because re-running ingest for a day already imported has
to land in the same file rather than write `hoi-an-2` beside it.

So a slug is taken when some entry holds it on a *different* date, and free
when it is unheld or held on this one. `entrySlugFromFile` in `lib/entries.ts`
is the shared derivation B119 collapsed the six copies of; use it rather than
re-writing the regex.

Check `--dry-run` reports the disambiguated name, since the whole point of that
flag is that the plan it prints is what a real run does.

Not doing: making ingest refuse, or routing it through `createDraft`. The first
breaks a batch import for one collision; the second is **B112**, a much larger
architectural question about whether the local door should exist at all, and it
should not be pre-empted here.

## Acceptance

- Ingesting two clusters that slug identically on different dates produces two
  distinct, addressable entries — not one file shadowing another.
- Re-running ingest over a folder already imported still joins the existing
  entry for that date rather than creating a numbered sibling beside it.
- `--dry-run` prints the same names the real run writes.
- A test drives `runIngest` over a fixture with the same place on two dates and
  asserts both days come back from `getEntryBySlug`.
