# W21 — RSS, search, export, archive

**Roadmap:** M4, M5, M6, M9, M10, M12, M14 · **Depends on:** W02 · **Wave E**

## Scope
- **M5 RSS/Atom** — nearly free given existing sitemap generation, and it reaches
  the technical friends who'll never install a PWA. Must respect W09 visibility.
- **M6 Data export** — "download my whole trip as a zip of markdown + photos."
  One endpoint, and it's **the entire anti-lock-in pitch made concrete**.
- **M4 Full-text search** — index built at build time. At 13 days the pager is
  enough; at 180, "where was that waterfall" needs an index.
- **M12 Upgrade path for self-hosters** — config version field + migration notes,
  so a `git pull` in six months doesn't break someone's site.
- **M14 Archive mode** — freeze a past trip's route and rates so a rebuild years
  later renders identically.
- **M9 Safety** — share live location with two trusted people; an emergency
  documents page only you can unlock. Nobody in this category does it well.
- **M10 Guestbook** — reactions cover the cheap version; free text needs
  moderation thought first. Lowest priority here.

## Acceptance
- [ ] RSS validates; **contains no non-public trip**
- [ ] Export produces a zip that `content/` can be restored from
- [ ] Search index built at build time; no runtime service
- [ ] Config version mismatch produces a clear upgrade message, not a crash
