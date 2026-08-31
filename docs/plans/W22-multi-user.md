# W22 — Multi-user by default

**Roadmap:** L1, §0.4, §0.5 · **Depends on:** W02, W03 · **Blocks:** most later packages

> This supersedes part of W03 and changes the shape of `content/`, the URL
> space, the config model and where generated files land. It is cheaper now
> than at any later point, and it gets more expensive with every package that
> ships against the single-user layout.

## Goal

One instance serves many people. Everything belonging to a person — trips,
media, config, generated postcards and books — lives under that person's own
directory, so the filesystem itself enforces the boundary rather than the code
remembering to.

## The layout

```
content/
  config.json                     ← SERVER config (deployment-wide)
  example/                        ← a real user, committed to git
    config.json                   ← USER config
    trips/
      example-trip/
        trip.md  costs.md  plan.md
        entries/*.md
        media/**
  severin/
    config.json
    trips/
      asia-2026/…
    postcards/                    ← generated, gitignored
    photobooks/                   ← generated, gitignored
    mail/                         ← generated, gitignored
```

**Generated output moves under the user.** A rendered postcard carries a home
address; a digest carries an email list. Today those land in `out/` and
`mail/`, shared across everyone on the instance. Putting them under
`content/<username>/` means one person's output cannot be read by resolving
another person's path, and it makes "delete this user" a single `rm -rf`.

**They are gitignored by default** (`content/*/postcards/`,
`content/*/photobooks/`, `content/*/mail/`) — with the deliberate exception of
`content/example/`, which contains nothing real.

## Splitting the config

`content/config.json` today mixes two things that belong to different owners.
They separate cleanly:

### Server config — `content/config.json`

Belongs to whoever runs the instance. A user cannot change it.

```jsonc
{
  "site": {
    "url": "https://fernscout.ch",
    "name": "Fernscout",
    "defaultUser": "severin"      // optional, see "bare URLs" below
  },
  "users": {
    "reserved": ["api", "media", "_next", "trips", "day", "admin", "static"]
  },
  "features": {                    // the CEILING — what this server can offer
    "mail":      { "enabled": false, "transport": "file" },
    "auth":      { "enabled": false },
    "contacts":  { "enabled": false },
    "postcards": { "enabled": false, "provider": "dry-run" },
    "photobook": { "enabled": false, "provider": "dry-run" }
  }
}
```

### User config — `content/<username>/config.json`

Belongs to the person. Everything personal is here, and nothing else is.

```jsonc
{
  "title": "Alex + Robin",
  "tagline": "…",
  "travellers": [{ "name": "…", "nickname": "…" }],
  "startLocation": "Zurich, Switzerland",
  "defaultLocale": "de",
  "locales": ["de", "en", "hu"],
  "baseCurrency": "CHF",
  "displayCurrencies": ["CHF", "EUR", "USD"],
  "units": "metric",
  "features": {                    // opt-IN, within the server's ceiling
    "costs":     { "enabled": true },
    "reactions": { "enabled": true },
    "push":      { "enabled": false },
    "postcards": { "enabled": false }
  }
}
```

### The rule that makes this coherent

> **Server capability is a ceiling; user config is an opt-in inside it.**
> A capability is on for a user only when the server *can* provide it (it has
> the credentials) **and** the user has asked for it. A user can never switch on
> something the server cannot do — so "enabled but unconfigured" stays a
> server-side boot error, and a user's config can never produce one.

`lib/capabilities.ts` grows a user argument and resolves both levels. The
existing failure behaviour is unchanged: absent when off, named error at boot
when the *server* is misconfigured, never a silent degrade.

## URLs

| Today | After |
| --- | --- |
| `/` | `/<username>` |
| `/trips` | `/<username>/trips` |
| `/trips/<id>` | `/<username>/trips/<id>` |
| `/day/<slug>` | `/<username>/day/<slug>` |
| `/media/<trip>/…` | `/<username>/media/<trip>/…` |

### Bare URLs for a single-user instance — as built

**`/<username>/…` is always canonical**, and `/` redirects to `defaultUser`
when one is set. This is the reverse of the first sketch, and simpler: it needs
no rewrite layer, there is exactly one URL per page rather than two competing
ones, and it matches the requested shape (`/username/trips/...` in the address
bar). A self-hoster still gets a working bare domain — it just forwards.

With no `defaultUser` and exactly one user, `/` forwards to them anyway; with
several, `/` lists them until the landing page (W24) replaces it.

## Usernames

The username is a path segment, so it is a security boundary and needs to be
treated as one.

- Pattern: `^[a-z0-9][a-z0-9-]{1,30}$` — same shape as trip ids.
- **Reserved list** from server config, plus anything the app routes:
  `api`, `media`, `_next`, `static`, `admin`, `trips`, `day`, `costs`,
  `gallery`, `map`, `i`, `join`, `sitemap.xml`, `robots.txt`, `manifest.webmanifest`.
- Resolution is by directory lookup, never by string concatenation into a path.
  `lib/media.ts` already resolves-then-verifies-containment; every user-scoped
  path must do the same.
- A directory under `content/` that is not a valid username is skipped with a
  warning, the way `lib/trips.ts` already skips a malformed trip.

## content/example/ — a real user, in git

Replaces `content.example/`, and does more:

1. **A starting point.** Clone, copy `content/example` to `content/<you>`, edit.
2. **Live documentation.** It serves at `/example` on any instance, including a
   fresh self-host, so a new user can see a working site immediately rather than
   an empty one.
3. **The test corpus.** Tests read it instead of maintaining a parallel fixture
   set — which also means the example is exercised on every test run and cannot
   quietly rot.

**One caveat to keep honest:** the example cannot hold deliberately malformed
input, because it has to render. Error-path tests (a broken `trip.md`, a bad
config, an unknown visibility value) keep a small dedicated fixture set. The
happy path uses `content/example`.

## Migration

There is real content in `content/trips/asia-2026` and it must survive.

1. `scripts/migrate-users.ts` — `content/trips/*` → `content/<username>/trips/*`,
   `content/config.json` split into server and user halves. Idempotent, with
   `--dry-run`.
2. `content.example/` → `content/example/`.
3. Media URLs gain the username; entry frontmatter keeps `/media/<trip>/…`
   relative and the username is supplied by the route, so **no entry files are
   rewritten** — the same trick that made the W03 move free.

## Blast radius

Already merged, and all of it needs updating:

| Package | What changes |
| --- | --- |
| **W02** config | Split into server/user; two-level capability resolution |
| **W03** content | Another move; `lib/contentRoot.ts`, `lib/trips.ts`, `lib/entries.ts`, `lib/media.ts` all become user-scoped |
| **W09** visibility | Trips resolve within a user; the enumeration test must now also prove no cross-user leak |
| **W13** postcards | Output moves to `content/<username>/postcards/` |
| **W01** branding | Server-level name vs per-user title — check nothing personal crept into the mark |

In flight when this was written (**merge them first, then do this**): W05
currency, W06 data layer, W16 ops. W06 in particular already puts an owner
column on every table (§0.5) — this is the filesystem half of the same idea.

## Acceptance

- [ ] `content/example` renders at `/example` on a fresh clone with no config edits
- [ ] Two users on one instance, each with their own trips, config, locale and currency
- [ ] `defaultUser` serves at bare URLs; `/<defaultUser>/…` redirects; one canonical form
- [ ] **Cross-user isolation test**: user A's private trip, media, sitemap entries and
      generated files are unreachable from any user B path, including traversal attempts
- [ ] A user cannot enable a capability the server lacks credentials for
- [ ] Reserved usernames rejected; invalid directory names skipped with a warning
- [ ] `scripts/migrate-users.ts --dry-run` then live, with no content lost
- [ ] Generated postcards land in `content/<username>/postcards/` and are gitignored
- [ ] Tests read `content/example`; only error-path fixtures remain separate
