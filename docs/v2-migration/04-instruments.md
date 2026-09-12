# Verification instruments — trust without believing the builder

The build is agent-run end to end; the owner accepted that on the condition
that verification never rests on an agent's claim about its own work. These
are the instruments. Build 1-3 as small scripts under scripts/ (auditable,
NO model calls inside) early in phase 2; they gate phase 3.

1. **Inventory diff** (`scripts/v2-inventory.mts`, to be written): dumps a
   content inventory of a journal — trips (id, title, dates, visibility,
   people count) -> days (slug, title, date, published?, photo count, cost
   sum, word count, has coordinates/weather?) -> media (count, bytes,
   sha256 of each ORIGINAL). Run against the pre-migration example (from
   git history / backup) and the replayed one; machine-diff; only the
   documented drops (00-decisions "no legacy" list) may appear. Media
   hashes must be byte-identical — bytes are the one thing replay must
   never transform.
2. **Migration report**: the replay migrator logs every transformation
   (dropped key, mapped field, decline written with the standard sentence,
   anything it could not carry). An unlisted transformation = gate failed.
3. **Render diff**: crawl old vs new example (anonymous reader; the pages:
   journal home, trips index, each trip, each day, gallery, costs, feed,
   sitemap), extract text content + image lists, diff; screenshot pairs
   for the drawn things. Old side comes from the last pre-replay deploy
   (crawl BEFORE deleting v1 rendering, or from an archived crawl —
   schedule the crawl before step 3's deletions).
4. **Builder =/= verifier**: after each build step, dispatch a FRESH agent
   with only the served openapi.json/docs and the live URL + a throwaway
   credential; it must drive the step's flows blind and file findings as
   tickets. Personas for /agent (test-with-personas skill).
5. **The owner's eyes**: the final gates (example sign-off, phase 4) are
   the owner clicking through — assemble the package (diffs, report,
   screenshots, feature checklist vs lib/capabilities.ts FEATURE_NAMES)
   and hand it over; never mark those gates done yourself.

Standing mechanical gates on every merge: npm run verify (build, tsc,
eslint, vitest, knip), the schema suite, the import-boundary test, and —
once routes serve — the openapi-from-code contract test.
