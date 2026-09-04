# W20 — Location tracking ingest

**Roadmap:** F1–F4, E4, E6, B7 · **Depends on:** W06 · **Wave F**

> **A PWA cannot track location in the background** — no web API for it on
> either platform. Everything here accepts data from apps that can.

## Scope
- **F1 `POST /api/track`** accepting the **OwnTracks** payload (and Overland's),
  token-authenticated per trip, points stored in the DB. Document how to point
  the app at it. Dawarich's ingestion endpoints are a good spec to read.
- **F2 Manual check-in** — "I'm here now" in the PWA using foreground
  geolocation. Honest, zero infrastructure, arguably better content than a
  breadcrumb.
- **F3 Route rendering + Douglas–Peucker simplification** so a 5-month track
  doesn't ship 400k points to a browser.
- **F4 Privacy defaults**: coarse points, configurable interval, a kill switch,
  and **never render live position on the public tier**.
- **E4 Google Timeline importer** — parse the on-device export JSON *and* the
  legacy Takeout format (your older archives). Test against redacted fixtures.
- **B7 Map tiles** — the current baked `lib/worldLand.json` can't do city level.
  **Protomaps** (self-hostable single `.pmtiles`, no per-view cost) fits the
  self-hosting story; MapTiler/Stadia are metered alternatives.

## Acceptance
- [ ] OwnTracks posts land and render
- [ ] 400k points render without shipping 400k points
- [ ] Live position never appears on a public trip
- [ ] Both Timeline formats import; malformed input degrades, never crashes
