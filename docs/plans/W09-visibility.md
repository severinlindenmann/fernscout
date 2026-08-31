# W09 — Per-trip visibility + password protection

**Roadmap:** C1, C2, C8, decisions 11 & 12 · **Depends on:** W02 · **Wave C**

## Goal
Each trip declares who may see it and who may see its costs. Password
protection works **with no database** — so the prototype gets it for free.

## Scope

### Frontmatter (decisions 11–12)
```yaml
visibility: public | unlisted | password
costsVisibility: public | guests
passwordHash: "$argon2id$..."      # only when visibility: password
```
Plus per-entry and per-gallery-item overrides. **Resolution: most restrictive
wins**, and hidden media is *absent from the DOM*, never CSS-hidden.

### Password gate (no DB)
argon2id hash in frontmatter, one form post, signed cookie scoped to that trip,
90 days. Rate-limited. Secret from env.

### The leak surface — gate every one of these
`/api/*` · media routes · **sitemap** · **RSS** · **OG images** · `robots.txt` ·
search index · the trip switcher · prev/next pagers · any "latest day" query.

> Write a test that enumerates routes and asserts a non-public trip appears in
> none of them. This is the single most likely defect in the whole project.

### Modes
- `public` — indexed, in sitemap, OG previews live
- `unlisted` — reachable by link, `noindex`, absent from sitemap and switcher
- `password` — gate first, nothing rendered before it

### Signed media URLs (C8)
For non-public trips, media goes through a session/cookie-checked route with
short-lived signatures. A private photo must not be fetchable by path.

## Acceptance
- [ ] Each mode behaves correctly, including `noindex` on unlisted
- [ ] `costsVisibility: guests` hides costs entirely when auth is off
- [ ] **Enumeration test**: no non-public trip in sitemap/RSS/OG/API/switcher
- [ ] Private media 403s without a session; signature expires
- [ ] Wrong password rate-limited; correct one persists 90 days
