# Roadmap — research & task backlog

A working document. Nothing here is implemented; everything here is a decision,
a task, or a piece of research feeding one of the two. `TODO.md` stays what it
is: the short list of things blocking *this* trip going live. This file is the
long game.

Last updated: 2026-08-30 · researched against the state of the web in Aug 2026.

---

## How to read this

**Effort** is calendar-ish effort for one person who knows the codebase:

| | meaning |
| --- | --- |
| **XS** | under two hours |
| **S** | half a day |
| **M** | one to three days |
| **L** | one to two weeks |
| **XL** | a month or more, or an ongoing programme |

**Every task has an ID** (`C3`, `F1`) so we can refer to them in later sessions
without re-describing them. Ordering inside a section is rough dependency
order, not priority — priority lives in [§14, the sequencing](#14-sequencing).

Items marked **◆** are research findings, not tasks. Items marked **?** are
open questions I could not answer for you and need your call.

---

## 0. Decisions taken

The eight open questions were answered on **2026-08-30**, plus two scoping
decisions taken the same day. This section is the decision log, not a list of
forks. Anything still open is in §15.

| # | Question | Decision |
| --- | --- | --- |
| 1 | Departure | **~6 months out (≈ March 2027)** — but explicitly *not* treated as the main constraint; agentic development is fast enough that build time isn't the binding limit |
| 2 | Data model | **Files canonical + Postgres index** |
| 3 | Licence | **AGPL-3.0 + separate trademark policy** |
| 4 | Name | **`Fernscout`, on `fernscout.ch`** (§11) |
| 5 | Hosted product | **Deferred — keep the seams clean, decide after the trip** |
| 6 | Audience | **~20–50 readers, most will never install anything → email is the product** |
| 7 | Currency | **Local currency in, CHF out, per-trip rates, reader-selectable display currency** |
| 8 | Photobook | **Script-first, for me — but must handle low volume (5–10 recipients), books *and* postcards** |
| 9 | Feature model | **Every optional capability off by default; enabling one is the self-hoster's act and requires their own credentials. The hosted tier supplies those credentials** (§1.1, §2.1) |
| 10 | Prototype scope | **`fernscout.ch` on the VPS, public site only, no Postgres** (§2.2) |
| 11 | Costs visibility | **Per-trip: `public` or `guests`** — set in `trip.md` |
| 12 | Trip visibility | **Per-trip: `public` / `unlisted` / `password`** |
| 13 | Languages | **Two layers** — maintained UI locales (de/en/hu, English fallback) vs arbitrary content languages (§1.2). Implies `M7` locale URLs |
| 14 | Domains | **`.ch` + `.com`** only |
| 15 | Media | **VPS disk, behind a media interface**; off-VPS backups regardless |
| 16 | Push | **Build it properly** (`D1` + `D7`), despite the audience estimate |
| 17 | Mail | **Proton SMTP** (Business plan — also provides the `fernscout.ch` mailbox) |
| 18 | Video | **Short clips only**, hard length cap, ffmpeg at ingest |
| 19 | Re-sharing | **Links forward freely, but access needs your approval** — email on each request, plus a guest overview |
| 20 | Photo consent | **Publish, remove on request**, stated in writing |
| 21 | Currencies | **Configurable list**, ECB reference rates fetched at build time |
| 22 | Trademark | **Skipped for now** — personal site. Revisit on the triggers in §0.6 |
| 23 | Multi-user | **Built in from the start**, not deferred: `content/<username>/…`, URLs at `/<username>/…`, server config separate from user config (§0.7, plan W22) |
| 24 | Editing | **The frontend has no editing UI, ever.** An agent reads `/documentation.txt` + `/agent.md`, authenticates for a 7-day write token, and edits on the owner's behalf. Browsers get read-only guest sessions only (§0.8, plan W23) |
| 25 | Agent doc name | **`/documentation.txt`**, not `llms.txt` — named for the person handing over the link. `llms.txt` stays an off-by-default alias. Kept out of search with `X-Robots-Tag: noindex`, never a `robots.txt` rule (plan W23) |
| 27 | No Docker | **Native install on the VPS** — Node, Caddy, systemd, and Postgres only when a feature needs it. The backend is Next.js route handlers plus a Node worker; **no second framework** (§2.3) |
| 26 | Landing page | **A landing page at `/`** (or `/welcome` when a `defaultUser` owns the root): what this is, how to point an agent at it, and a link to the live `/example` user (plan W24) |

### 0.1 Data model — files canonical, DB as index ✅

Markdown + media stay the source of truth. Postgres holds only what files
can't: users, sessions, access grants, push subscriptions, reactions, jobs,
print orders. A content watcher reindexes on change.

This keeps both stories honest: "clone it and edit markdown in Obsidian" stays
literally true for self-hosters, and the hosted version in §12 remains possible
without a rewrite. It also matches what `lib/entries.ts` already does. The cost
is one extra moving part — the indexer — and it's worth it.

**Consequence:** every schema decision from here gets a user/tenant column even
though there's one user today (see 0.5).

### 0.2 Licence — AGPL-3.0 + trademark policy ✅

Self-hosting stays completely free. Anyone running a *modified* version as a
service must publish their changes. The code is free; the name and logo are
not.

**Amended by decision 22.** The trademark is *not* being registered for now, so
the policy covers an **unregistered** mark. That is normal and costs nothing —
an unregistered name still has protection under Swiss unfair-competition law
and common-law use — but it is weaker than a registration, and the policy should
say "Fernscout is our project name; don't imply endorsement" rather than claim a
registered mark it doesn't have.

Still decide the licence header policy and CONTRIBUTING.md before the first
outside contributor (M13), because relicensing later needs their consent.

### 0.6 Trademark — deferred, with triggers

Skipped as a personal site (decision 22). Revisit if **any** of these happen:

- The public repo makes `Fernscout` a prominent brand rather than a folder name.
- Anyone pays you money — a postcard, a photobook, a hosted plan.
- You find a conflicting mark in the same class (worth one free database check
  before the repo goes public, even now — see §15.2).

Registration is CHF 350–550 for up to three classes and stays available; the
risk of waiting is that someone else registers it first, not that you lose the
right to use it.

### 0.3 Departure — ≈ March 2027, but not the binding constraint ✅

Your position, and it's fair: with agentic development, build time isn't what
limits this. So §14 is no longer cut around a deadline pivot.

Two things the date still governs, and only two:

- **Migrating live data mid-trip is genuinely bad.** The §1 refactor and the
  §5 media move get harder in proportion to how much real content exists. Doing
  them before departure isn't about having time — it's about having less to move.
- **The nightly writing ritual (M3) can't be tested from a desk.** It has to be
  boringly reliable *before* it's the only thing standing between you and a dead
  blog in month two.

### 0.4 Hosted product — deferred, seams kept clean ✅

Build the personal site and the OSS repo properly. Don't build multi-tenancy —
just don't foreclose it: user-scoped IDs in the schema, no hardcoded personal
paths, media namespaced by trip. Decide for real once you've lived with the
workflow for five months.

**Consequence:** §12 stays in the document but nothing in it is scheduled. The
agentic work in §7 is *not* affected — it's valuable for you and self-hosters
regardless of whether a hosted product ever exists.

### 0.7 Multi-user — built now, not deferred ✅

**Amends decision 5.** The app supports many users from the start: content is
laid out per user, URLs carry the username, and server config is separate from
user config. Details and migration in `docs/plans/W22-multi-user.md`.

What this does **not** change: running a *hosted service* — signup, billing,
quotas, moderation, GDPR obligations (§12, L1–L8) — stays deferred. Those are a
business, and the decision to start one is still after the trip.

The distinction matters because it is the difference between a week and a
quarter:

| Built now | Still deferred |
| --- | --- |
| Many users on one instance | Strangers signing themselves up |
| `content/<username>/`, per-user config and trips | Billing, plans, quotas |
| Filesystem isolation between users | Moderation, abuse handling, takedowns |
| `/<username>/…` routing, reserved names | Custom domains per customer |

**Why now rather than later.** §0.5 argued for keeping the seams clean so
multi-tenancy stayed possible. Doing the filesystem half immediately is
strictly cheaper than doing it after more packages ship against a single-user
layout — and it makes the isolation structural rather than a rule the code has
to remember. W06's owner-column-from-the-first-migration is the database half of
the same idea.

**The one thing to get right:** a self-hoster with one user should not be forced
onto `/severin/…`. Server config names a `defaultUser` who is also served at the
bare URLs, with a single canonical form — the same aliasing the current trip
already has.

### 0.8 The agent is the editor ✅

**Decision 24.** Reading happens in a browser. Writing happens through an agent
holding a token. There is no WYSIWYG, no upload widget, no draft manager, no
media library, no mobile editor — and there won't be.

This is the largest single scope reduction available, and it is also the thing
that makes §7 true rather than aspirational. What replaces all of that UI is one
markdown document an agent reads (`/agent.md`), a discovery file at `/documentation.txt` (`llms.txt` is an
off-by-default alias), and an API.

**Two token classes, deliberately decoupled**, so the owner reading the site on
their phone is not carrying a credential that can rewrite it:

| | Agent — write | Guest — read |
| --- | --- | --- |
| Lifetime | 7 days | up to 365 days |
| Channel | `Authorization: Bearer`, never a cookie | httpOnly cookie, never a bearer |
| Scope | `write:content`, one username | read, bounded by grants and visibility |

The owner can hold a guest session too; it grants exactly what anyone else's
does. **The token itself is never emailed** — a short-lived single-use code is,
and it is exchanged over HTTPS. Agent writes land as drafts (G7).

**Amends W08.** Auth is no longer one flow; it is two, obtained separately.

### 0.5 What "clean seams" concretely means

Cheap now, expensive to retrofit. This is the whole cost of keeping §12 alive:

- Every DB table gets an owner column from the first migration.
- Media paths are `<trip>/<...>` already — keep it that way, never
  `public/media/<slug>`.
- Nothing personal in code — that's §1 (A1–A5) and it's now load-bearing for
  more than aesthetics.
- Config is data, never constants in `lib/` — and after decision 23, split into
  server config (`content/config.json`) and user config
  (`content/<username>/config.json`).
- Anything a person owns — including generated postcards, books and mail — is
  written under `content/<username>/`, never to a shared directory.

## 1. Foundation — making the repo genuinely cloneable

*Your item 1. This is the load-bearing refactor; several other sections assume
it's done.*

### 1.2 Two language layers

*Decision 13. The distinction that makes multi-language survivable:*

| | **UI / chrome** | **Content** |
| --- | --- | --- |
| What | Menus, buttons, labels, dates, error text | Entry titles and bodies, trip taglines |
| Who provides it | **We maintain** `de`, `en`, `hu` | The author, in whatever language they write |
| If missing | **Falls back to English chrome** | Falls back to the entry's default text |
| Configurable | Self-hoster picks from the maintained set | Anything — Croatian, Portuguese, whatever |

Nobody has to translate a nav bar to publish a post. A Croatian self-hoster
writes Croatian entries under English menus and it looks deliberate rather than
broken.

**What this costs in code:** `LOCALES` and `LOCALE_LABEL` in `lib/i18n.ts`
become the *maintained dictionary set*, `config.json` becomes a selection plus
additions, and `parseTranslations()` in `lib/trips.ts` — which hardcodes
`["de","hu"]` today — must read the configured list instead. That's A3.

◆ **This implies M7.** Multi-language that can't be linked, shared or indexed
isn't multi-language — it's a toggle. `/de/…` routes with `hreflang` move into
Wave 2, while there's little content to re-route.

◆ **Default locale should be `de`**, not English as it is today, given a CH/DACH
audience. Configurable via `defaultLocale`.

### 1.1 Capabilities — everything off by default

*Decided: the self-hosted version ships with every optional feature disabled.
Turning one on is the user's act, and it requires them to supply their own
credentials. Our hosted version supplies those credentials for them.*

```jsonc
// content/config.json — committed to git. NEVER contains secrets.
{
  "site":  { "title": "…", "locales": ["de","en"], "currency": "CHF" },
  "features": {
    "reactions": { "enabled": true  },
    "costs":     { "enabled": true  },
    "push":      { "enabled": false },
    "mail":      { "enabled": false, "transport": "smtp" },
    "auth":      { "enabled": false },
    "contacts":  { "enabled": false },
    "postcards": { "enabled": false, "provider": "stannp" },
    "photobook": { "enabled": false, "provider": "peecho" }
  }
}
```

**The rule that keeps this honest:** `config.json` is committed and says *what*
is on; **secrets never appear in it** — SMTP passwords, Stannp keys, Peecho
keys, VAPID keys and the cookie secret are environment variables only. A config
file in a public repo is exactly where credentials go to die.

**Each capability declares what it needs, and boot validates it:**

| Capability | Needs a DB? | Needs credentials | Default |
| --- | --- | --- | --- |
| Public content, trips, days, media, maps | **no** | — | **on** |
| Reactions | no — existing file store is fine | — | on |
| **Password-protected trips** | **no** | cookie secret | off |
| Push | no — file store | VAPID keypair | off |
| Mail / digests | only if `contacts` is on | SMTP host, user, password | off |
| Auth (email OTP, identified guests) | **yes** | cookie secret, mail on | off |
| Contacts / address book | **yes** | mail on | off |
| Postcards | yes (addresses) | Stannp or Swiss Post credentials | off |
| Photobook | no | Peecho / Gelato API key | off |

◆ **Worth noticing: password-protected trips need no database.** A hash in the
trip's frontmatter plus a signed cookie is the whole mechanism. So the single
most useful privacy feature for a family audience is available even in the
no-DB prototype — it does not have to wait for Postgres.

**Three rules for how a disabled feature behaves:**

1. **Absent, not broken.** No dead buttons, no half-rendered sections, no
   "coming soon". If `costs` is off, the nav item doesn't exist.
2. **Enabled but unconfigured is a startup error with a name.** Not a 500 at
   3am when someone presses send. "`features.mail` is enabled but `SMTP_HOST`
   is unset" — say which flag and which variable (this is A7).
3. **Never silently degrade.** A digest that quietly doesn't send is worse than
   one that refuses to start.

| ID | Task | Effort |
| --- | --- | --- |
| **A10** | **Capability registry** — each feature declares `requires: { env, db }`; one boot-time validator resolves every flag to enabled or disabled-with-a-reason, logged once and visible on a health page (B8). Everything else in the codebase asks the registry, never `process.env` directly. | **M** |
| **A11** | **`config.example.json` + `.env.example`**, with the split above documented: flags in the committed file, secrets in the environment. This pair *is* the self-hosting documentation. | **S** |

| ID | Task | Effort |
| --- | --- | --- |
| **A1** | **Move media into the content folder.** `public/media/<trip>/…` → `content/trips/<trip>/media/…`, served through a route handler or a build-time copy/symlink. Media then travels with the trip it belongs to, and `content/` becomes the single personal directory. | **M** |
| **A2** | **`content/config.json`** (or `config.yaml`) — the one file a cloner edits. Everything currently hardcoded in `lib/site.ts` moves here: travellers, tagline, start location, site URL. Plus new: `locales` (user-defined list, not the baked `["en","de","hu"]` in `lib/i18n.ts`), `defaultLocale`, `currency` + display format, `units` (km/mi), `features: { costs, reactions, push, slideshow }`. | **M** |
| **A3** | **User-defined locales.** `LOCALES` and `LOCALE_LABEL` are const arrays today, and `parseTranslations()` in `lib/trips.ts` hardcodes `["de","hu"]`. Make the locale set data-driven from A2; UI strings ship as `content/locales/<code>.json` with English fallback. | **M** |
| **A4** | **Multi-currency, three layers** (decided, see §0 Q7). **(a) Store original**: costs keep their local currency (`450 THB`) — never lossy-converted at write time. **(b) Per-trip rate table**: each trip folder carries its own rates, so `asia-2026` and a 2029 trip to the same country convert at their own historical rates. Rates live with the trip, not globally. **(c) Reader display currency**: a US reader picks USD and it persists — mirror the `LocaleProvider` pattern with a `CurrencyProvider`. | **M** |
| **A4b** | **The second hop, from ECB rates** (decision 21). Local→CHF uses the trip's frozen historical rate; CHF→reader's currency needs a current one. Fetch the **ECB reference rates** at build time — free, official, no API key, ~30 currencies — and cache them into the content folder so the site still builds offline. Display currencies are a configurable list; anything ECB doesn't cover gets a manual rate. Label conversions "≈". | **S** |
| **A5** | **Strip personal data from code.** After A2, grep for the travellers' names and nicknames, the author's surname, the home city and the trip ids, anywhere outside `content/`. Zero hits is the acceptance test — `test/depersonalised.test.ts` derives the terms from the content folder so it keeps working after a rename. | **S** |
| **A6** | **A real demo content set** in `content.example/`, and `npm run seed:demo` copies it. The current demo *is* the live content, which is why the repo can't be shown to anyone yet. | **S** |
| **A7** | **Config validation with good error messages.** A cloner's first experience is a typo in `config.json`; the app should say which key and what was expected, not stack-trace. `lib/trips.ts` already has the right instinct (log + skip, don't throw) — apply it here. | **S** |
| **A8** | **`.gitignore` the content folder in the fork story?** No — but do document the two modes: content committed (a personal blog, git is your backup) vs content ignored + on a volume (a hosted instance). | **XS** |
| **A9** | **Media out of git for large trips.** Already flagged as OPS-1 in `TODO.md`. Ingest resizes to ≤2000px; originals go to object storage or a synced folder. This is what makes A1 survivable at 5000 photos. | **M** |

◆ **Note on A1/A9 tension:** media inside `content/` is the clean story, but a
5-month trip is 10–30 GB of photos. Resolution: `content/trips/<id>/media/`
holds *derivatives* (web-sized, committed or synced), and originals live
wherever the user points `MEDIA_ORIGINALS_DIR`. The content folder stays
cloneable; the originals stay yours.

---

## 2. Architecture & hosting

*Your "do we need anything else?" question.*

◆ **You need less than you think.** The full production stack:

| Piece | Choice | Why |
| --- | --- | --- |
| App | Next.js 16 — **this is the backend**, see §2.3 | — |
| DB | PostgreSQL 17 — **optional** | Only for what files can't hold: users, sessions, contacts, grants, jobs. Not installed in the prototype (§2.2) |
| TLS + reverse proxy | **Caddy**, installed as a package | Automatic ACME/Let's Encrypt, auto-renewal, no cron. Removes a whole class of expiry incidents. Needs :80 for the challenge and :443. |
| Media | VPS disk first; S3-compatible later | See B4 |
| Jobs | A single Node worker process, same codebase (pg-boss or a table + poller) | Photobook rendering, email digests, push fan-out, ingest. No Redis until something demands it. |
| Backups | `pg_dump` + `restic`/`rclone` to off-VPS storage, nightly, *tested restore* | The reactions JSON lesson in `TODO.md` generalises: the only state not in git is the only state you can lose. |

Nothing else. No Redis, no Kubernetes, no separate API service, no Vercel.

### 2.1 Three deployment tiers

The capability model (§1.1) gives three ways to run this, from the same code:

| | **Prototype / minimal** | **Self-hosted, full** | **Hosted (ours)** |
| --- | --- | --- | --- |
| Content | files | files | files (per tenant) |
| Database | **none** | Postgres | Postgres, shared |
| TLS | Caddy, one domain | Caddy, one domain | Caddy **on-demand TLS**, a domain per customer |
| Mail | — | their SMTP | ours |
| Postcards / photobook | — | their provider keys | ours |
| Who holds credentials | nobody | the user | us |
| Effort to stand up | an afternoon | a day, plus accounts | (§12, deferred) |

**The self-hosted promise:** you get the whole app for free, and every feature
that costs money or needs an account is off until you bring your own. Nothing
phones home, nothing is crippled, nothing requires us.

**What the hosted version actually sells** is precisely the column above:
we hold the SMTP account, the print-provider contracts and the certificates,
and you get a custom domain without touching DNS. That is a services business
wrapped around a free app — which is the honest version of open core, and it's
what the AGPL choice (§0.2) protects.

### 2.3 No Docker, and no second backend framework ✅

**Decision 27.** The stack installs natively: Node, Caddy, systemd units in
`deploy/`, and Postgres only once a feature needs it. `scripts/deploy.sh` is a
pull, an install, a build and a restart.

Docker earns its keep when you want a portable artifact built once and run
anywhere. Here there is one machine, built on the machine that serves it. What
it cost instead: a second packaging format to keep in step, image builds in CI,
and a self-hoster needing to understand containers before they can run their own
travel blog.

**The prototype tier gets simpler, not more complex**: Postgres is a package you
did not install, rather than a profile you did not enable.

#### "Do we need FastAPI, or some other backend?"

**No. Next.js already is the backend**, and adding a second framework would be
the most expensive mistake available right now.

What exists today and is already server-side: route handlers under `app/api/*`
(health, reactions, trip access, push subscriptions), server components reading
the filesystem, the Kysely data layer in `lib/db` and `lib/repos`, and boot
checks in `instrumentation.ts`. That is a backend. It is not a placeholder for
one.

Adding FastAPI would mean a second language and runtime to install and monitor,
models duplicated across TypeScript and Python and kept in sync by hand, two
processes and two logs, a proxy or CORS between them, and a self-hosting story
that starts "first install Node **and** Python". Against decisions 3, 9 and 27,
that is a straight loss.

**The only thing genuinely missing is a worker** — one Node process, same
codebase, for digests, push fan-out, print rendering and ingest. That is
already in the stack table.

**When would Python be right?** Only if a task needs a library that exists
nowhere else — local Whisper transcription is the plausible one. Even then the
answer is to shell out to it from the worker as a subprocess, not to stand up a
second web framework. `osxphotos`, the other Python tool in this project, runs
on your Mac, never on the server.

### 2.2 Prototype scope — decided

**Buy `fernscout.ch`, put it on the VPS, ship the public site. No Postgres.**

| In | Out |
| --- | --- |
| Next.js standalone + Caddy on the VPS, real TLS | Postgres — **not needed and not installed** |
| Public trips, days, media, maps, costs | Auth, private trips, identified guests |
| Reactions and push, on the existing `DATA_DIR` file store | Contacts, mail, digests |
| `DATA_DIR` outside the repo + backups (M1) | Postcards, photobook |
| *Optionally* password-protected trips — free, no DB (§1.1) | Multi-tenancy |

◆ **This is the proof that §0.1 was the right call.** "Files canonical, DB as
index" means the database is genuinely *optional* rather than merely
deferred — the prototype is not a crippled version of the app, it's the same
app with the flags off. If the prototype needed Postgres to render a public
page, the architecture would be wrong.

**Consequence for §14:** B2 and B3 (Postgres, and moving `.data/*.json` into it)
leave Wave 1 entirely. They arrive with auth and contacts, not before.

| ID | Task | Effort |
| --- | --- | --- |
| **B1** | **Docker Compose stack**: app + postgres + caddy + worker. One `docker compose up` on a fresh VPS, and the same file is what a self-hoster runs. | **M** |
| **B2** | **Postgres + migrations.** Pick the driver/ORM now: Drizzle (SQL-first, small, good with Next) or Prisma. Schema starts tiny: `users`, `sessions`, `access_grants`, `push_subscriptions`, `reactions`, `jobs`. | **M** |
| **B3** | **Move `.data/*.json` into Postgres** (reactions, push subs). Removes the fork-mode pm2 constraint in `TODO.md` and the per-process write queue in `lib/store.ts`. | **M** |
| **B4** | **Media interface + VPS disk** (decision 15). All reads/writes go through one small interface so swapping to S3-compatible storage later is a config change, not a refactor. Off-VPS backups are non-negotiable either way (M1). Reference prices for when it outgrows the disk: ◆ Prices as of 2026: Cloudflare R2 ~$0.015/GB stored, **$0 egress**; Backblaze B2 ~$6.95/TB stored, free egress up to 3× stored/month (unlimited via Cloudflare); Hetzner Object Storage from €6.49/mo incl. 1 TB storage + 1 TB egress. For photo serving, egress dominates → **R2**, or Hetzner if you want everything in one invoice next to the VPS. | **S** |
| **B5** | **CDN / image resizing at the edge.** With R2 + Cloudflare you get caching free. Otherwise `next/image` on the VPS does the work — fine for family traffic, not for a hosted product. | **M** |
| **B6** | **Deploy pipeline.** GitHub Actions → build image → push → pull on VPS. Zero-downtime is optional at this scale; a 5-second restart is fine. | **S** |
| **B7** | **Map tiles.** ◆ The current map is a baked `lib/worldLand.json` outline — great for a world overview, useless for "which street in Hanoi". City-level maps need a tile source: MapLibre GL + Protomaps (self-hostable single `.pmtiles` file, no per-view cost) or MapTiler/Stadia (metered). Protomaps fits the self-hosting story best. | **M** |
| **B8** | **Health checks, uptime ping, and an error sink** (Sentry self-hosted is overkill; a log file plus an uptime monitor is enough). While you're on the road you cannot debug what you can't see. | **S** |
| **B9** | **Privacy-friendly analytics** — Umami or Plausible, self-hosted, so you can see whether family actually reads it without shipping Google to grandparents. | **S** |

---

## 3. Access control: public, private, password

*Your items 2 and 16, plus the "share a link, approve the person" flow.*

◆ **You need three independent mechanisms, not one.** They serve different
people and mixing them into one "privacy" setting is the classic mistake:

1. **Public** — indexed, shareable, no login. (Most past trips.)
2. **Password-protected** (your item 2) — one shared secret per trip, no
   account, no email, no approval. This is the one you hand to 40 relatives on
   a Christmas card. Cheapest thing in this document, highest ratio of
   convenience to effort for non-technical readers.
3. **Identified access** — the person proves an email address once, you approve
   them, and *then* you can notify them individually and revoke them
   individually. Required for notifications; not required for reading.

Visibility must be settable at three levels: trip, day/entry, and individual
photo (your "maybe specific pictures").

| ID | Task | Effort |
| --- | --- | --- |
| **C1** | **`visibility: public \| unlisted \| password` plus `costsVisibility: public \| guests` in `trip.md` frontmatter** (decisions 11–12), with per-entry and per-gallery-item overrides. Resolution rule: most restrictive wins, and a private photo inside a public day is simply absent from the DOM — not hidden with CSS. | **M** |
| **C2** | **Password-protected trips.** A signed cookie (`trip:<id>` scope, e.g. 90 days) after one form post. Hash with argon2id, rate-limit attempts (`lib/rateLimit.ts` exists). No account, no email. Must also gate the API routes, media routes, sitemap, RSS and OG images — the leak is always the thing you forgot to gate. | **M** |
| **C3** | **Email OTP login.** ◆ You do **not** need Auth0/Clerk/Keycloak. **Better Auth** (TS, v1.6 as of May 2026) has first-party `emailOTP` and `magicLink` plugins, keeps sessions in your own Postgres, and has no external service call. Auth.js/NextAuth still works but is no longer the default recommendation for new projects in 2026. Session length: 30–90 days is fine for this threat model; make it configurable. | **M** |
| **C4** | **Guest request → approval flow.** Stranger opens a share link → enters email → gets a 6-digit code → lands in "waiting for approval" → you get a notification → approve/deny from an admin page → they're in. Store `access_grants(user, trip, level, channels)`. | **M** |
| **C5** | **Per-guest notification preferences** set *by you* at approval time and editable by them: email digest / push / neither. This is the record that §4 fans out over. | **S** |
| **C6** | **Admin surface**: who has access, who's pending, last seen, revoke. Boring, and you will use it constantly. | **M** |
| **C7** | **Share links with embedded intent** — `?invite=<token>` prefills the trip and skips a step. Older readers drop off at every extra screen; this is worth the token plumbing. | **S** |
| **C8** | **Signed media URLs** for private photos (short-lived, or a session-checked route handler). Without this, private photos are public to anyone who guesses a path. | **M** |
| **C9** | **Re-sharing = forward freely, approve individually** (decision 19). The invite link is an *invitation to request*, not a grant: anyone it reaches gets the form, nobody gets access without you. A forwarded personal link only prefills the language — identity still comes from the email confirmation (C12), so it can't impersonate. | **S** |
| **C16** | **Approval notification** — email you on each new request ("someone wants to follow the trip"), linking straight into the guest overview (C6). Without it, requests sit unseen while you're on a bus. | **S** |

◆ **On "no service needed":** correct. Email OTP + your own Postgres covers
everything you described. The only external dependency is *sending mail* (§4).

### 3.1 One contact record, not three lists

*Prompted by the postcard idea — and it collapses a chunk of this document.*

Right now the backlog asks the same people for the same details three separate
times: C4 collects an email to approve a guest, C5 records which channels they
want, H8 keeps a postal address for printing, and the locale switcher (§1 A3)
has no idea who anyone is. **These are one record.**

```
contact
  name, email (identity key), preferred_locale
  postal: name, line1, line2, postcode, city, country   -- optional, encrypted
  wants_email_digest, wants_postcard                    -- explicit, separate
  access grants (trip, level), push subscriptions
  created_via (which invite link), confirmed_at, last_seen
```

Everything downstream reads from it: the digest picks `preferred_locale` per
recipient, the postcard script selects contacts with an address, access control
reads the grants. One form, one table, one place to revoke.

**Two link shapes**, because they serve different situations:

| | Personal link — `fernscout.ch/i/<token>` | Open link — `fernscout.ch/join/<trip>?lang=de` |
| --- | --- | --- |
| You generate | One per person, with name and language baked in | One per trip, pasted into a family group chat |
| Landing page | Opens **already in their language**, name prefilled — they type an address and press one button | Opens in the link's language, falls back to `Accept-Language` |
| You know who filled it | Yes, by construction | No — needs your approval before it's real |
| For | Grandparents, anyone you'd otherwise have to phone | Broad sharing where you don't have a list yet |

The personal link is the one that makes this work for non-technical readers:
your item was *"preferred language we can embed in the link"* — bake it into the
token and the recipient never sees a language picker at all.

| ID | Task | Effort |
| --- | --- | --- |
| **C10** | **`contacts` table + the two link shapes.** Replaces the separate designs in C4/C5/H8. | **M** |
| **C11** | **The collection form** — one screen, big type, in their language: name, email, optional postal address ("only if you'd like a real postcard in the mail"), and two clearly separate checkboxes for digest and postcard. Not a signup form; it should read like a guestbook. | **M** |
| **C12** | **Double opt-in on email** (confirm link before anything is ever sent). Required for deliverability, and it's the lawful basis for the digest. | **S** |
| **C13** | **Self-serve edit/unsubscribe page**, linked from every email footer: change language, change address, opt out, delete me. Also your GDPR/DSG delete path (§12 L5). | **S** |
| **C14** | **Encrypt postal addresses at rest.** ~50 named people's home addresses is real personal data — a different risk class from anything else in this repo. Encrypt the column, keep the key out of the content folder, and never log it. | **S** |
| **C15** | **Abuse guard on the open link** — rate limit, and never print anything without your explicit approval. A public form asking for postal addresses invites junk. | **S** |

◆ **This pulls work forward.** C10/C11 are the same form as the guest signup, so
building postcards "later" and access control "now" would mean building it
twice. See the re-cut in §14.

---

## 4. Notifications

*Your items in the main goal + item 16's mail question.*

◆ **Findings, briefly:**

- **PWA push works everywhere now, with one catch.** iOS supports Web Push
  since 16.4 and it still requires the site to be **added to the Home Screen**
  first — push cannot be requested from a Safari tab, and the permission prompt
  must come from a user gesture. `components/PushOptIn.tsx` already handles the
  iOS copy, which is most of the battle. Android/desktop have no such
  restriction. Cost: zero, forever.
- **WhatsApp is a trap for this use case.** Since July 2025 Meta bills
  **per delivered message** by category and country. Marketing templates run
  ~$0.025 in the US and **>€0.11 in Germany**; you'd also need a Meta Business
  verification and a BSP (Twilio/360dialog/Gupshup) with its own markup, plus
  template pre-approval for every message shape. Free service messages only
  apply to conversations *the user starts*. For 40 relatives × 150 days this is
  both expensive and a compliance project.
  → **Use a `wa.me` share button instead** (free, one tap, they forward it
  themselves) and put the effort into email + push.
- **Telegram is the free automated option** if you want a chat channel: the Bot
  API is free, supports channels and 30 msg/s broadcast out of the box. Whether
  your family will install Telegram is a people question, not a tech one.
- **Email is the channel that actually reaches older readers.** ◆ Proton: SMTP
  Submission exists but only on **Proton Mail business plans** (from ~$6.99/user/mo)
  — it's SMTP, not a transactional API, and it carries per-day send limits you
  should check against your recipient count before relying on it. It's fine for
  a personal instance's digest to 40 people. For the *hosted* product you'd want
  a real transactional sender (Postmark/Resend/SES) for deliverability and
  bounce handling.

| ID | Task | Effort |
| --- | --- | --- |
| **D2** | **Email digest — the primary channel** (decided, §0 Q6: ~20–50 readers, most will never install anything). "3 new days since you last looked", one HTML template, weekly or on-publish, one-click unsubscribe. At this audience size Proton's SMTP submission is comfortably within limits. **This is the notification feature; everything else is a bonus.** | **M** |
| **D1** | **Push fan-out on publish**, per-recipient, respecting §3 visibility. Extends `scripts/notify.mts` from "send to all subscriptions" to "send to grants that can see this trip". Demoted below D2 — it will reach a handful of people, not the family. | **M** |
| **D3** | **Mail transport abstraction** — SMTP (Proton) for self-host, provider API for hosted, both behind one interface. Do this once, early; retrofitting a second transport later is worse. | **S** |
| **D4** | **`wa.me` / native share button** on each day and on the trip. | **XS** |
| **D5** | **Telegram bot channel** (optional, config-gated). | **M** |
| **D6** | **Notification preferences page** for the reader, reachable from every email footer. | **S** |
| **D7** | **"Install this on your Home Screen" onboarding** — illustrated, one screen, shown once. Kept in scope by decision 16. Still build it after D2 ships: email reaches everyone, push reaches whoever manages the install. | **S** |
| **D8** | **Digest quiet rules** — never more than one message a day, never at 3am in the reader's timezone. | **S** |

---

## 5. Photos, geodata & ingest

*Your items 6 and 17 (the export half).*

◆ **Google Timeline: mostly bad news, and it explains your missing data.**
In late 2024 Google discontinued the web Timeline and moved location history to
**on-device storage**; only the last 90 days were migrated and older data was
deleted unless manually backed up — which is why some of yours is gone.
**Google Takeout no longer exports it** (you get a stub file saying backups are
encrypted on-device). The only export path now is *from the phone*: Google Maps
→ Settings → Your Timeline → Export. Output is JSON (some EU accounts get CSV).
Note the format differs from old Takeout archives: on-device exports identify
stops by **coordinates only**, no street addresses.

◆ **iCloud photos: good news.** `osxphotos` (macOS, Python) can export your
Photos library with full metadata, using `exiftool` to write GPS/keywords into
the exported files, and can convert HEIC→JPEG on the way out. This is a
one-command path from your library to a folder the ingest script can eat. For
non-Mac users, `exiftool` alone reads GPS from HEIC/JPEG fine.

| ID | Task | Effort |
| --- | --- | --- |
| **E1** | **`npm run ingest -- <folder>`** — the single most important script in this repo. Folder of photos (+ optional text) → resized derivatives, EXIF read for GPS + timestamp, entry markdown written with frontmatter filled, media placed. Already in `TODO.md`; promote it to blocking. | **L** |
| **E2** | **EXIF → day grouping.** Cluster photos by capture time and location into candidate days/stops, so ingest proposes "24 Aug, Da Lat, 31 photos" rather than asking you. | **M** |
| **E3** | **Reverse geocoding** coords → place/country, offline-capable. Options: a local dataset (GeoNames cities1000, ~10 MB) or Nominatim with caching. Offline matters — you'll be ingesting on bad wifi. | **M** |
| **E4** | **Google Timeline importer** — parse the on-device export JSON (and the legacy Takeout format for your older archives) into a `route` layer per trip. Handle both schemas; write tests against a redacted fixture. | **M** |
| **E5** | **`osxphotos` recipe in the docs** + a wrapper script: export an album with GPS to a staging folder, then run E1. | **S** |
| **E6** | **Map the real route**, not just stop-to-stop lines, once E4 lands. Requires B7. | **M** |
| **E7** | **HEIC/HEVC handling** end to end (browser upload path too — Safari uploads HEIC that Chrome won't render). `sharp` handles HEIC if built with libheif; verify before relying on it. | **S** |
| **E8** | **Video — short clips only** (decision 18). Hard length cap (~30 s), ffmpeg transcode to h264/webm at ingest, poster frame, originals kept out of the served path. A 4K phone clip is ~200 MB and will not be served from `content/`. Scoped down deliberately: this covers the lantern-street moments without a media pipeline. | **M** |
| **E9** | **Face/EXIF privacy scrub** — strip GPS from *served* derivatives (keep it in the sidecar metadata), because a public photo with home coordinates is a real leak. | **S** |
| **E10** | **Duplicate detection** on ingest (perceptual hash) — you will import the same folder twice at some point. | **S** |

---

## 6. Live tracking on the phone

*Your item 17 (the tracking half).*

◆ **Straight answer: a PWA cannot do background location tracking.** There is
no web API for it on iOS or Android — geolocation only runs while the page is
open and foregrounded, and iOS has no background sync for web apps. Nothing in
2026 changed this. If automatic route capture matters, the options are:

| Approach | Reality |
| --- | --- |
| **Existing tracker app → your API** ← recommended | **OwnTracks** (iOS/Android, free, open source) or **Overland** post GPS points to an arbitrary HTTPS endpoint. You write one route handler that accepts their payload. Zero app development, works today, users keep control. This is exactly how **Dawarich** (self-hosted Google-Timeline replacement, Rails + PostGIS) does it, and it's worth reading their ingestion endpoints as a spec. |
| **iOS Shortcuts automation** | "When I arrive somewhere / at 20:00, POST my location." Free, no app, but flaky and user-configured. |
| **Manual check-in** | A button in the PWA: "I'm here now." Honest, zero infrastructure, and arguably better content than a GPS breadcrumb. |
| **Native app** | Correct answer technically, wrong answer economically — you already ruled it out and I agree. Revisit only if the hosted product has paying users asking. |

| ID | Task | Effort |
| --- | --- | --- |
| **F1** | **`POST /api/track` accepting the OwnTracks payload** (and Overland's), token-authenticated per trip, storing points in Postgres. Document how to point the app at it. | **M** |
| **F2** | **Manual "check in here" button** in the PWA using the foreground Geolocation API. | **S** |
| **F3** | **Route rendering + simplification** (Douglas–Peucker) so a 5-month track doesn't ship 400k points to the browser. Depends on B7. | **M** |
| **F4** | **Battery/privacy defaults**: coarse points, configurable interval, a kill switch, and never render live position to the public tier. | **S** |

---

## 7. The agentic layer

*Your items 3, 8, 10 — and the actual differentiator.*

◆ **This is the part of the plan that isn't a worse Polarsteps.** Polarsteps
(free, plus a €8.99/mo "Plus" tier since July 2026) and FindPenguins own
auto-tracking and travel books. You will not out-feature them on tracking. What
they structurally cannot offer is: *your content is plain markdown and photos in
a folder you own, and any AI agent can read and write it.* Lean all the way in.

◆ **MCP specifics for a remote server (2026):** transport is **Streamable
HTTP** (SSE-only is legacy). Auth is **OAuth 2.1 + PKCE**; the server acts as a
resource server, publishes `/.well-known/oauth-protected-resource` (RFC 9728),
and **must not** forward the client's token to downstream APIs. Ship read tools
first; write tools need idempotency keys because agents retry.

| ID | Task | Effort |
| --- | --- | --- |
| **G1** | **`AGENTS.md` + skills in the repo** (your item 3). Concretely: `add-a-day`, `add-a-trip`, `ingest-photos`, `write-from-voice-memo`, `generate-photobook`, `deploy`. These are cheap, immediately useful to you *during the trip*, and are the best possible demo of the agentic pitch. **Start here.** | **S** |
| **G2** | **Voice-memo → entry pipeline.** Upload photos + a voice note → transcribe (Whisper local, or an API) → an agent drafts the entry with the photos inline and asks the gap-filling questions ("how did you get here? what did it cost?") → you approve. This is the workflow that decides whether the blog survives month two, and it's your item 8 almost verbatim. | **L** |
| **G3** | **Interview mode** — show a photo, ask one question, accept text or voice. Works on a phone, in bed, offline-queued. The unglamorous UI here matters more than the model. | **M** |
| **G4** | **Public REST API** over trips/days/media with token auth. Everything else in this section is a client of it — build it first, MCP second. | **M** |
| **G5** | **Remote MCP server** exposing: `list_trips`, `get_day`, `create_day`, `attach_media`, `set_costs`, `search_entries`. Streamable HTTP + OAuth 2.1 as above. | **L** |
| **G6** | **Direct file access for agents** — a WebDAV or S3-ish view of the content folder, so "point Claude at my trip folder" works without any API at all. Cheap, and very on-brand. | **M** |
| **G7** | **Agent-written drafts are always drafts.** A `status: draft` frontmatter field and a review queue. Never let a generated entry publish itself; one hallucinated memory in front of your family is unrecoverable. | **S** |
| **G8** | **Cost extraction from receipts** (photo of a receipt → cost line) — a natural extension of E1/G2 and genuinely tedious to do by hand. | **M** |

◆ **You already have a connector called `Traveler.md` in this session's tool
list.** Is that the working name / an existing prototype? It's a *very* good
name for exactly this pitch (markdown + travel + agentic) — see §11.

---

## 8. Photobooks & postcards

*Your items 9, 11, 12 — rescoped by §0 Q8 from a business to a tool.*

◆ **Print-on-demand APIs, as of 2026:**

| Provider | Notes |
| --- | --- |
| **Peecho** | Purpose-built for exactly this ("upload a PDF, we print and ship a photo book"), documented public print API, global fulfilment. Acquired by Prodigi in April 2024 — check current API/terms continuity before committing. |
| **Gelato** | 33 countries, ~100 local print partners, API customers include Canva; strong local production = lower shipping and better CO₂ story. Heavier API surface (built for e-commerce catalogues). |
| **Cloudprinter** | Similar model, EU-centric partner network, straightforward API. |
| **Lulu Direct** | Worth pricing too (strong on books specifically) — not verified in this pass. |

◆ **The hard part is not the API — it's the PDF.** Every provider wants a
print-ready file: **PDF/X (X-1a, X-3 or X-4), CMYK with an embedded ICC
profile, 300 DPI images, ~3 mm bleed on every edge, embedded fonts, flattened
transparency**. HTML→PDF via headless Chrome produces RGB and will be rejected
or printed with shifted colours. Budget real time for a rendering pipeline
(server-side layout → CMYK conversion via Ghostscript/`littlecms`, or a
commercial SDK like IMG.LY CE.SDK which exports CMYK PDF/X-3 from Node).

◆ **Postcards.** **Swiss Post's PostCard Creator API** exists on
`developer.post.ch` — but it's positioned as a B2B *campaign/mailshot* product,
so expect a contract and minimums rather than self-serve. For self-serve and
international: **Stannp** (EU + US endpoints, simple `POST /postcards/create`)
or **PostGrid**. Realistic plan: Stannp for the world, Swiss Post only if the
volume justifies the paperwork.

◆ **Price anchor:** Polarsteps travel books run €36–€150 (24 pages minimum,
premium/lay-flat tiers). That's your ceiling; your cost is print + shipping,
and the margin is the product.

### 8.0 The prototype — postcards from the road

*Your `abertschi.ch` reference.* The idea is right and it's the best possible
first build in this section. The tooling behind it needs a caveat.

◆ **What that project actually is:** `abertschi/postcard_creator_wrapper`, a
Python wrapper around the **Swiss Post PostCard Creator** REST API — the app
that gives Swiss customers free postcards. It is **reverse-engineered, not
official**: it logs in with SwissID username/password and, per its own README,
**does not support two-factor authentication**.

◆ **Maintenance status, checked 2026-08-30:** last code commit **August 2023**,
last touch to the repo November 2023, 53 stars, 6 open issues — including a
closed one titled *"Two factor authentification"* from Sept 2024. Its history is
a list of breakages: *"changes in internals of swissid token authentication due
to introduction of anomaly-detection"*, *"Swissid login failed"*, endpoint
migrations. **Assume it is broken in 2026 until a spike proves otherwise.**
SwissID has been pushing 2FA hard in the years since.

◆ **And even working, the economics don't scale to your use case:** Swiss Post's
free allowance is on the order of *one card per week per account* (verify the
current limit — I could not, my search quota ran out). For 10 recipients that's
ten weeks. It's a lovely weekly ritual; it is not a batch tool.

**So: pluggable sender, decided at the end, not the beginning.**

| Backend | Use |
| --- | --- |
| **`file` (dry run)** | Renders the card to PNG/PDF on disk. Build this first — it's the whole layout problem with none of the API risk, and you can iterate on design offline. |
| **Swiss Post PostCard Creator** | The free weekly card, *if* the spike shows it still works. Nice-to-have, never a dependency. |
| **Stannp** | Paid, official, documented, works from anywhere in the world, batch-friendly. The one that will still work in month four from a hostel in Vietnam. |

◆ **The strategic bit:** a postcard is 148×105 mm at 300 DPI with bleed — it is
**the photobook's print pipeline at 1/50th the size**. Building H6 first means
H2 (the hard CMYK/PDF-X work) arrives already de-risked, on a surface small
enough to actually get proofed by post. This is the strongest argument for
doing postcards before the book, ahead of even the revenue argument.

| ID | Task | Effort |
| --- | --- | --- |
| **H9** | **Card renderer + `file` backend**: photo front, message + address block back, correct trim/bleed/safe area. Pure output, no network. | **M** |
| **H10** | **Spike: does the Swiss Post API still work in 2026?** Timebox it to an afternoon. If SwissID 2FA blocks it, stop — don't fix someone else's reverse-engineered auth from the road. | **S** |
| **H11** | **`npm run postcard`** — pick a photo, write a message, pick recipients from `contacts` (C10), choose a backend, send or dry-run. | **M** |

---

### 8.1 Scope, as decided

**Script-first, for you — but it must handle low volume: 5–10 recipients, books
*and* postcards.** (§0 Q8.)

That is a much smaller thing than §8 originally described, and the difference is
worth being precise about, because it's the difference between a week and a
quarter:

| Dropped | Kept |
| --- | --- |
| Checkout, Stripe, VAT, refund policy, order support, customer accounts | The print-ready PDF pipeline — unchanged, still the hard part |
| A hosted preview for strangers | A **recipient list** in the content folder (names + addresses), and a batch run over it |
| Per-customer layout customisation | Provider integration, driven from the CLI rather than a checkout |

Printing 8 copies of a book for family, or mailing 10 postcards from the road,
is a *batch* feature — not an e-commerce feature. No payments, no accounts, no
support burden. H5 (Stripe/VAT) drops out entirely for now; revisit only if
§12 happens.

| ID | Task | Effort |
| --- | --- | --- |
| **H2** | **Print-ready PDF export** — the real work, and unchanged by the rescope: CMYK, PDF/X, 300 DPI, ~3 mm bleed, embedded fonts and ICC profile. HTML→PDF via headless Chrome gives you RGB and gets rejected. **Get one real proof printed before building anything on top of it.** | **L** |
| **H1** | **Layout engine**: trip → book (page plan, photo grids, captions, full-bleed maps, a route page). Design work as much as code, but for one user it can be opinionated instead of configurable — which removes most of the difficulty. | **L** |
| **H6** | **Postcard flow** — pick a photo, write a message, pick recipients from the address list, send via Stannp. **Do this first:** it's the smallest piece here, it works *during* the trip rather than after it, and it's the one your family will actually react to. | **M** |
| ~~H8~~ | ~~Recipient list~~ — **superseded by `C10`** (the contacts table). Addresses belong with the people, not in a separate file. | — |
| **H3** | **Preview** — page-flip preview from the same layout data, plus a low-res PDF. For a script this is just "open the PDF", so it collapses to nearly free until there are customers. | **S** |
| **H4** | **Provider integration** behind one interface: Peecho or Gelato for books, Stannp for postcards, as a CLI batch. Swiss Post's PostCard Creator API is B2B/contract — skip unless volume ever justifies the paperwork. | **M** |
| ~~H5~~ | ~~Payments, Stripe, VAT~~ — **dropped** by the rescope. | — |
| ~~H7~~ | ~~Pricing model~~ — **moot**, no customers. | — |

## 9. Presentation & sharing

*Your item 13.*

| ID | Task | Effort |
| --- | --- | --- |
| **I1** | **Presentation mode for the slideshow** — 16:9, landscape, big type, keyboard/remote control, no chrome, auto-advance with a per-slide dwell, works over AirPlay/Chromecast screen mirroring. `components/SlideShow.tsx` is the seed. | **M** |
| **I2** | **A narrated cut** — one slide per day with the day's best photo + one sentence, auto-generated, so "show us the trip" takes 8 minutes instead of 3 hours. | **M** |
| **I3** | **Export to video/GIF** of the route unfolding (this is FindPenguins' free flyover; it's the most-shared artefact in the category). | **L** |
| **I4** | **Wake lock + no-sleep** during presentation. | **XS** |
| **I5** | **Fullscreen TV-friendly font sizes** — the same accessibility work that helps older readers. | **S** |

---

## 10. Quality, bugs & the audit

*Your item 5, plus what `TODO.md` already measured.*

`TODO.md` already holds the measured problems (SCALE-1 home page growth,
OPS-1 photos in git, PERF-1 no route splitting, TEST-1 no tests). Not repeating
them here — they stay owned there. What's missing:

| ID | Task | Effort |
| --- | --- | --- |
| **J1** | **Manual desktop + mobile audit pass**, written up as findings with screenshots: iPhone SE / iPhone Pro / iPad / 1440px desktop, both orientations, Safari + Chrome + Firefox. | **M** |
| **J2** | **Accessibility pass aimed at your actual audience**: 60+ readers on phones. Minimum 16px body, tap targets ≥44px, contrast ≥4.5:1 (the `navy-500` overload in `TODO.md` §3 is already a known failure), and no interaction that requires a hover. | **M** |
| **J3** | **Playwright smoke suite** — walk the pager, run axe on each route. Already listed as TEST-1; it's also the only way you'll safely refactor during §1. | **M** |
| **J4** | **Slow-network / offline behaviour.** You will be on 3G in a bus. Does the PWA serve the last-read day offline? Does an upload survive a dropped connection? | **M** |
| **J5** | **Error states for readers**: expired session, revoked access, wrong password, deleted trip. Currently these are 404s or worse. | **S** |
| **J6** | **Timezone correctness.** Entry dates are local-to-where-you-were; "today" for a reader in Zurich is not "today" in Hanoi. `components/TripCountdown.tsx` already hit one hydration bug from this. | **S** |

---

## 11. Brand, name & domain

*Your item 14, researched for a **CH-first, DACH-wide** audience.*
*Availability below was checked by WHOIS/DNS on 2026-08-30 — it is a snapshot,
and good names go fast. Re-check on the day you buy.*

### 11.1 The audience split that decides the name

You have two audiences and they want opposite things:

| | The readers (CH/DACH, many 60+) | The product (§12, OSS + hosted) |
| --- | --- | --- |
| Must be | Heard on the phone and typed correctly first try | Pronounceable in English, searchable, not already a company |
| Language | German — an English name is a barrier, not a signal | English, or at least language-neutral |
| Trust signal | `.ch` | `.com` |

**A German name caps the product at DACH. An English name costs you nothing
with your family *if they never have to type it*.**

That's the resolution: **don't make one name do both jobs.**

- **The trip site** gets a warm, obvious, German-or-personal domain that
  relatives can type from a Christmas card.
- **The product** (if §12 ever happens) gets its own brand later, once you know
  whether it's real. Nothing in the code depends on this.

◆ Cheapest correct move for the trip site: **the travellers' own first names
under `.ch`** — a couple of spellings were free at the time of writing. ~CHF
10/year, unmistakably yours, zero trademark risk forever, and for family it
beats any brand name because they already know the words. A subdomain of a
domain you already own costs nothing at all if you want to start today.

### 11.2 TLD rules for this region

| TLD | Findings |
| --- | --- |
| **.ch** ✅ | **No residency or citizenship requirement** — anyone can register, via a registrar (SWITCH stopped selling direct in 2015). One catch worth taking seriously: SWITCH may **verify registrant identity at any time**, and if the data is wrong, incomplete or unverified the domain is **deleted permanently, without refund**. Use your real name and address, not a privacy proxy. |
| **.de** ⚠️ | Registerable from abroad, **but the admin-c must have a German postal address** for service of legal documents. On top of that, DENIC is running a **full data-verification sweep across all .de domains during 2026** under NIS-2. As a Swiss resident: either use a registrar that supplies a German admin-c/service address, or treat .de as defensive-only. |
| **.at** ✅ | No residency requirement, straightforward. Cheap insurance for DACH reach. |
| **.com** ✅ | Still the default for anything you want strangers to trust. ~CHF 10–15/yr. |
| **.travel** ❌ | **Rejected.** Restricted TLD (you must assert travel-industry involvement, sometimes via a UIN), and the cheapest renewal found was **~$114/year**. No upside over .ch/.com. |
| **.md** ⚠️ | Cute for the agentic pitch, meaningless-to-hostile for a Swiss grandparent, and Moldova pricing is high. Vanity redirect at best. |

**Buy .ch + .de + .at + .com together and redirect three of them.** For DACH
that's ~CHF 40/year total and it removes a whole category of future regret.

### 11.3 What's actually available

Single German dictionary words are gone — `fernweh` (.com/.ch/.de/.app all
taken), `unterwegs`, `etappe`, `kompass`, `wanderlust`, `wegweiser`,
`streifzug`, `meilenweit`, `weitweg`, `ausblick`, `fahrtenbuch`. Don't spend
time there. Compounds are wide open.

**Verified available, ranked:**

| Name | .ch | .de | .com | .at | Read |
| --- | --- | --- | --- | --- | --- |
| **Fernscout** | ✅ | ✅ | ✅ | ✅ | *Travel mail.* The full set is free, which is rare and worth acting on. Instantly warm to any German speaker of any age, and it describes the product exactly: news from far away arriving at home. Bonus: it pre-names the postcard business (§8 H6). |
| **Reisespur** | ✅ | ✅ | ✅ | — | *Trace of a journey.* Also free in `.app`/`.blog`. Matches both halves of the app — the GPS route and the written trail. Cooler and more modern than Fernscout, less cosy. No baggage of any kind. |
| **Reiseheft** | ✅ | ❌ | ✅ | — | *Travel booklet.* The warmest of the three and the most print/photobook-native. **.de is taken**, which hurts for DACH. |
| **Reisegruss** | ✅ | ✅ | ✅ | — | Warmest for grandparents, but **don't**: Germany writes *Gruß*, Switzerland writes *Gruss*. Half of DACH will type the domain wrong. A real, permanent typo tax. |
| Others free | `fernpost.ch`, `meinfernweh.ch`, `fernwehbuch.ch`, `etappenbuch.ch`, `wegbuch.ch`, `tagreise.ch`, `reiseweg.ch`, `reisemappe.ch`, `unterwegsbuch.ch`, `wegmarke.ch`, `abstecher.ch`, `zwischenstopp.ch`, `etappa.ch`, `slowloop.ch` | | | | |
| Note | **`reisetagebuch.ch` is free** — the exact generic search term. Great SEO, weak brand. Worth CHF 10 as a redirect. | | | | |

◆ **`traveler.md` is taken** (AWS nameservers), as are `travel.md`, `trip.md`,
`tour.md`, `route.md`. Only `reise.md`, `weg.md` and `journal.md` are free. So
if the connector name in your tooling was pointing at a domain plan, that
plan needs a new target.

### 11.4 The one legal thing to check before you commit

◆ **The "Post" question, since Fernscout is the front-runner.** Encouraging
precedent: the Swiss Federal Administrative Court held that Swiss Post
**cannot** register *POST* or *DIE POST* on their own for core postal services —
the terms are descriptive and must stay free for competitors
(*Freihaltebedürfnis*). So "Post" is not a private word. A compound like
**Fernscout**, in a travel-journal class rather than letter carriage, is a
materially different mark and looks defensible.

Two caveats I could not close:
- There is a small Swiss transport business trading as *Angelika's Fernscout*
  (Remetschwil AG). Different service class, likely no conflict, but it exists.
- **I could not complete the trademark register search** (Swissreg / DPMA /
  EUIPO) — the research budget for this session ran out. **This is an open
  item, not a clean bill of health.**

◆ **How the Swiss trademark system works, which matters here:** the IGE
**does not check for conflicting earlier marks** when it registers yours. That
is entirely the applicant's problem, and it's how people end up with an
*Abmahnung* after launch. Filing costs on the order of **CHF 350–550** for up
to three classes, ten years of protection — but the *search* is the part with
the value, and a database query alone is explicitly not sufficient for a
reliable answer.

### 11.5 Decision — `fernscout.ch` ✅

**Decided 2026-08-30: the site is `Fernscout`, on `fernscout.ch`.**
Re-verified free at the moment of the decision, along with `.com`, `.de`,
`.at` and `.app`.

Why it holds up: instantly warm to any German speaker of any age, no umlaut and
no `ß`/`ss` split to mistype, `.ch` is the right trust signal for the primary
audience, and it pre-names the postcard business in §8 (H6).

Two things to keep in view, neither of them blocking:

- **The rest of the set is still unclaimed today.** The reason Fernscout scored
  first was that `.ch`/`.de`/`.at`/`.com` were all free at once — that's what
  makes a brand rather than a URL. `.ch` alone is a perfectly good start; just
  know that the set breaks up the moment anyone else notices, and reassembling
  it later costs aftermarket prices instead of ~CHF 30. (K3 is left open for
  this, not marked done.)
- **The trademark search (K2) is still outstanding.** Not a blocker for a family
  trip site — it becomes one before any money goes into a logo or before §12
  turns commercial. The Swiss precedent is encouraging (see 11.4), but the IGE
  does not check prior rights for you.

Deferred by this decision: the **product** brand (§12). Nothing in the code
depends on it, and an English name chosen for a product that may not exist is
the most likely thing in this section to be wasted work.

| ID | Task | Effort |
| --- | --- | --- |
| **K1** | **Register `fernscout.ch`** ← *decided*, then set `NEXT_PUBLIC_SITE_URL=https://fernscout.ch` and update the fallback in `lib/site.ts` (currently `https://example.com`). Unblocks TLS, OG previews, sitemap and the whole `TODO.md` §1 deploy checklist. Use accurate registrant data — SWITCH deletes on failed identity verification, without refund. | **XS** |
| **K2** | **Trademark search on `Fernscout`** — Swissreg + DPMA + EUIPO — before any money goes into a logo, and professionally if §12 goes commercial. IGE won't do it for you. Still outstanding. | **S** |
| **K3** | **Defensive TLDs — `fernscout.com` / `.de` / `.at`** (~CHF 30/yr), redirected to `.ch`. Open, deliberately deferred. `.de` needs an admin-c with a German postal address. Cheap now, expensive once someone else takes them. | **XS** |
| **K4** | **Logo + wordmark**, SVG-first, legible at 16px favicon and on a book cover. The slots already exist: `app/icon.svg`, `app/apple-icon.tsx`, `app/opengraph-image.tsx`. | **M** |
| **K5** | **Design tokens as a theme** — the accent system (`sky`/`yellow`/`green`/`coral`/`navy` in `lib/trips.ts`) is already half a design system; formalise it so self-hosters can rebrand from `config.json` (A2). | **M** |
| **K6** | **OG/social preview per trip and per day**, branded, verified against the real domain. | **S** |
| **K7** | **Mail domain setup**: SPF, DKIM and DMARC before the first digest goes out, or every email lands in spam. An afternoon, and non-optional. | **S** |

---

## 12. The hosted product

*Your items 4 and 18.* **Deferred (§0.4)** — nothing here is scheduled. Kept
in the document because §0.5's clean seams are what preserve the option, and
because the positioning below is worth having written down before you need it.

◆ **Positioning.** Not "another travel journal". The line is roughly:

> **The travel journal your AI can actually use.** Your trip is markdown and
> photos in a folder you own. Talk to it, write it by voice, export it, print
> it, self-host it. No lock-in, no feed, no algorithm.

The proof points are all things Polarsteps structurally can't say: MCP server,
open API, plain-file export, AGPL self-hosting, and "your data leaves as easily
as it arrived."

| ID | Task | Effort |
| --- | --- | --- |
| **L1** | **Multi-tenant routing** — `site.com/<username>/<trip>`, reserved-word list, username claiming. | **L** |
| **L9** | **Managed credentials** — the hosted tier supplies what the self-hoster would bring: SMTP, print-provider keys, VAPID. The capability registry (A10) resolves them from the platform instead of the user's environment; same code path, different source. | **M** |
| **L10** | **Custom domains per customer** — Caddy **on-demand TLS** issues certificates for customer domains as they resolve, gated by an authorisation endpoint so anyone pointing DNS at you can't mint certs. This is the single most visible thing the hosted tier sells. | **M** |
| **L2** | **Signup, plans, billing, quotas** (storage is the real cost driver). | **L** |
| **L3** | **Onboarding that produces a first day within 5 minutes** — upload 10 photos, get a drafted day. If this takes longer, nobody comes back. | **L** |
| **L4** | **Abuse & moderation**: public pages mean spam, illegal content, and DMCA. Have a takedown path before launch, not after. | **M** |
| **L5** | **GDPR/Swiss DSG**: privacy policy, DPA with subprocessors, export + delete on request, and a real answer for "there are strangers' faces in these photos." | **M** |
| **L6** | **Docs site + a 3-minute self-host video.** For an OSS project, docs *are* the marketing. | **M** |
| **L7** | **Launch plan**: Show HN / r/selfhosted / r/solotravel, a Product Hunt day, and — the strongest one — a genuinely good write-up of *your own* 6-month trip as the reference instance. Ship the product by shipping the trip. | **M** |
| **L8** | **Migration importers** from Polarsteps / FindPenguins exports. The cheapest possible acquisition channel and directly on-message about lock-in. | **M** |

---

## 13. Things not on your list

*Your item 19.*

| ID | Item | Effort |
| --- | --- | --- |
| **M1** | **Backups you have restored from at least once.** The single highest-value item in this document. A 5-month trip journal with no tested restore is a 5-month trip journal you might lose. | **S** |
| **M2** | **Offline-first writing.** Draft an entry, attach photos, queue the upload, sync when there's wifi. Without this the workflow breaks exactly where you'll be using it. | **L** |
| **M3** | **A "what I'll actually do each night" ritual, designed and timed.** If it's more than ~10 minutes, it won't happen in month three. Design the workflow first, then build to it. This should shape E1/G2/G3 more than any feature request does. | **S** |
| **M4** | **Full-text search** across entries (already in `TODO.md` ideas — at 180 days it stops being optional). | **M** |
| **M5** | **RSS/Atom feed** — free given the existing sitemap code, and it reaches the technical friends who'll never install a PWA. | **XS** |
| **M6** | **Data export / portability** — "download my whole trip as a zip of markdown + photos." One endpoint, and it's the entire anti-lock-in pitch made concrete. | **S** |
| **M7** | **Locale URLs.** `TODO.md` §4 already flags that all three languages share one URL, so German and Hungarian pages can't be linked, shared, or indexed. If the translations matter for family, this becomes required, not optional. | **M** |
| **M8** | **Photo policy, in writing** (decision 20): a plain line on the About page saying these are personal travel photos and anything will be taken down on request, with a working contact address. Per-photo private mode (C1) stays available for what you'd rather not publish at all. | **XS** |
| **M9** | **Safety features**: share live location with two trusted people, an emergency contacts/documents page (insurance, passport scans) that only you can unlock. Genuinely useful for a 6-month trip and nobody in this category does it well. | **M** |
| **M10** | **Guestbook / comments with moderation** — reactions already exist; free text needs a moderation story first. | **M** |
| **M11** | **Storage budget math up front.** 5 months × ~30 photos/day at 4 MB ≈ 18 GB of originals. Decide now what's kept, at what size, and where — retrofitting is a migration over hostel wifi. | **XS** |
| **M12** | **Upgrade path for self-hosters** — config version field + migration notes, so a `git pull` six months from now doesn't break someone's site. | **S** |
| **M13** | **CONTRIBUTING.md, issue templates, CI on PRs, a licence header policy.** Cheap; the difference between "a repo" and "a project". | **S** |
| **M14** | **Retro/archive mode** — for past trips, freeze the route/costs so a rebuild years later still renders identically. | **S** |

---

## 14. Sequencing

Re-cut around dependencies and impact rather than a departure pivot (§0.3).
Waves, not dates — each one is shippable on its own.

### Wave 0 — The prototype (§2.2)

Public site, real domain, no database. An afternoon of ops plus whatever
content is ready.

`K1` register `fernscout.ch` · `TODO.md` §1 (real content, env, TLS) ·
`B1` Docker + Caddy · **`M1` backups with a tested restore** · `B8` health check
and uptime ping · optionally `C2` password-protected trips (free without a DB)

### Wave 1 — Live, and the workflow proven

The goal is a real site at a real domain that you can write to every night.
Nothing here is speculative.

`E1` the ingest script · **`M3` design the nightly ritual and time it** ·
`A10`+`A11` the capability registry and config/secrets split ·
`K7` SPF/DKIM/DMARC · `D3` mail transport · **`D2` email digest** ·
`G1` skills + AGENTS.md

Postgres is **not** in this wave — see §2.2. `B2`/`B3` arrive with auth and
contacts in Wave 3.

> The two starred items are the ones that decide whether this survives to month
> three. `E1` and `M3` are the same problem seen from two sides: if writing up a
> day takes more than ~10 minutes, it stops happening, and no feature elsewhere
> in this document compensates.

### Wave 2 — The refactor, while there's little content to move

Not urgent because of the date — urgent because every one of these gets harder
in proportion to how much real content exists (§0.3).

`A1` media into content · `A2` `config.json` · `A3` user-defined locales ·
`A4`+`A4b` multi-currency · `A5` de-personalise · `A6` demo content ·
`A7` config validation · `A9` media out of git · `M11` storage math

### Wave 3 — Readers

**`B2` Postgres + migrations** (owner column from day one, §0.5) · `B3` move
`.data/*.json` into Postgres — *both land here, not earlier* ·
`C1` visibility model · **`C10`+`C11` contacts table and the collection form** ·
`C12` double opt-in · `C13` self-serve edit · `C14` encrypt addresses ·
`C15` abuse guard · `C3` email OTP · `C4` guest approval (now a thin layer over
C10) · `C6` admin surface · `C8` signed media URLs · `D1` push fan-out ·
`D6` preferences page ·
`D7` iOS install onboarding · `D8` quiet rules · `J1`+`J2` desktop/mobile and
accessibility audit · `J5` reader error states · `J6` timezones ·
**`M2` offline writing** · `M5` RSS · `M6` data export

### Wave 4 — On the road

Iterate on the real thing. Do **not** plan a refactor here.

`G2`+`G3` voice-memo → entry (this is where it gets designed properly, against
actual tiredness and actual wifi) · `F1`+`F2` tracking · `I1` presentation mode
for calls home · `E4` Google Timeline import for past trips · bug fixes

**Postcards move earlier** — `H9` renderer, `H10` Swiss Post spike, `H11` the
send command belong in Wave 3 alongside the contacts work, not here. They share
the same table, and the renderer de-risks Wave 5's PDF pipeline.

### Wave 5 — After

`H2` print-ready PDF (already de-risked by `H9`), then `H1` layout engine
(you'll finally have real content to lay out) · `H4` provider integration ·
`I3` route video ·
`G4`+`G5` API and MCP · `B7`+`E6` real map tiles · `M4` search

### Deferred indefinitely

All of §12. Nothing scheduled; the seams stay clean (§0.5) and that's the whole
investment until after the trip.

### Quick wins — XS/S, no dependencies, any time

`D4` share button · `M5` RSS · `I4` wake lock · `M6` export · `G1` skills ·
`A5` de-personalise · `A8` document the two modes · `M8` photo consent note ·
`H3` preview (collapses to nearly free at this scope)

---

## 15. Still open

All 22 decisions are in §0. Nothing is left that blocks any wave. What remains
is mine to resolve, plus a short list of things that only become questions
later.

### 15.1 Mine to resolve — no input needed from you

| | Item |
| --- | --- |
| **H10** | Spike the Swiss Post PostCard Creator API — does it still work in 2026, what is the current free-card allowance? Timeboxed to an afternoon; abandon rather than fix someone else's reverse-engineered auth (§8.0). |
| **B2a** | DB driver: **Drizzle**. SQL-first, no codegen daemon, doesn't fight the files-are-canonical model. Recorded so it isn't a silent assumption. |
| **E7** | Verify `sharp` handles HEIC in our build before the ingest script depends on it. |
| **K2b** | One free database check (Swissreg / DPMA / EUIPO) for an existing `Fernscout` in a conflicting class — cheap even though registration is deferred, and the only thing that would change the name. I'll run it when my search quota resets. |

### 15.2 Becomes a question later, not now

| | Trigger |
| --- | --- |
| **Trademark registration** | Any of the three triggers in §0.6 — public repo with the name prominent, money changing hands, or a conflicting mark found |
| **Object storage** | When the VPS disk hurts. The media interface (B4) is what makes this a config change |
| **`.de` / `.at` domains** | If DACH readership grows beyond family, or someone else takes them |
| **Transactional mail provider** | If Proton SMTP shows bounce or deliverability problems (D3 makes the swap cheap) |
| **Hosted product** | After the trip (§0.4) — and everything in §12 with it |
| **Native app** | Only if paying customers ask (§6). The answer today is no |

### 15.3 Things worth revisiting once the trip is real

Not questions, just assumptions that deserve a check against reality:

- **Does the nightly ritual actually take under 10 minutes?** (M3) If not, nothing
  else in this document matters much.
- **Do ~20–50 readers turn out to be right?** Decision 6 drives the whole
  notification design; the first month will tell you.
- **Is push actually used?** Decision 16 kept it against my read of the audience.
  Instrument it (B9) rather than arguing about it.

## Sources

Auth & MCP: [Better Auth vs NextAuth 2026](https://makerkit.dev/blog/tutorials/better-auth-vs-clerk) ·
[Open-source auth libraries 2026](https://www.better-stack.ai/p/blog/open-source-auth-libraries-in-2026) ·
[OAuth 2.1 for remote MCP servers](https://mcp.directory/blog/oauth-21-for-remote-mcp-servers-streamable-http-explained-2026) ·
[MCP auth spec evolution](https://medium.com/@ayshsandu/the-evolution-of-mcp-auth-every-spec-every-lesson-2024-11-05-2026-07-28-draft-e3f165a12fdb)

Notifications: [PWA iOS limitations 2026](https://www.magicbell.com/blog/pwa-ios-limitations-safari-support-complete-guide) ·
[Do PWAs work on iOS](https://www.mobiloud.com/blog/progressive-web-apps-ios) ·
[WhatsApp Business API pricing 2026](https://www.engagelab.com/blog/whatsapp-business-api-pricing) ·
[WhatsApp per-message costs](https://blueticks.co/blog/whatsapp-business-api-pricing-2026) ·
[Telegram Bot API](https://core.telegram.org/bots/api) ·
[Proton SMTP setup](https://proton.me/support/imap-smtp-and-pop3-setup) ·
[Proton Mail business pricing](https://www.g2.com/products/proton-mail-for-business/pricing)

Geodata: [Google Timeline export today](https://www.mileagewise.com/google-maps-mileage-tracker/export-google-maps-timeline/) ·
[Takeout & location history](https://discoveryengineering.net/blog/google-takeout-location-history/) ·
[osxphotos](https://github.com/RhetTbull/osxphotos) ·
[Dawarich location tracking](https://dawarich.app/location-tracking/)

Print & money: [Peecho print API](https://www.peecho.com/solutions/print-api) ·
[Gelato photo books](https://www.gelato.com/products/photo-books) ·
[Swiss Post PostCard Creator API](https://developer.post.ch/en/technical-specifications-of-postcard-api) ·
[Stannp postcards API](https://www.stannp.com/us/direct-mail-api/postcards) ·
[PDF/X print-ready standards](https://img.ly/blog/what-does-print-ready-pdf-mean-understanding-pdf-x-standards-for-professional-printing/) ·
[Polarsteps review 2026](https://mattsnextsteps.com/polarsteps-review-is-polarsteps-the-best-travel-tracking-app/)

Naming & domains: [.ch registration policy](https://kb.centralnicreseller.com/domains/tlds/ch/) ·
[.ch overview](https://en.wikipedia.org/wiki/.ch) ·
[DENIC .de requirements](https://www.denic.de/en/products/de-domains/registration/) ·
[.de NIS-2 transparency rules 2026](https://www.twobirds.com/en/insights/2026/germany/germany-new-transparency-rules-for-,-d-,de-domains--action-required) ·
[.travel pricing](https://tld-list.com/tld/travel) ·
[Swissreg trademark database (IGE)](https://www.ige.ch/de/uebersicht-dienstleistungen/digitales-angebot/datenbanken-und-verzeichnisse/swissreg/markendatenbank) ·
[Markenanmeldung Kosten CH](https://www.jurata.ch/guide/marke-registrieren-kosten) ·
[BVGer: «DIE POST» nicht schutzfähig](https://www.mll-news.com/bvger-marke-die-post-ist-fur-kernbereiche-des-postgeschafts-nicht-eintragungsfahig/)

Infra: [Cloudflare R2 pricing 2026](https://mecanik.dev/en/posts/cloudflare-r2-pricing-explained-real-costs-vs-s3-and-backblaze/) ·
[R2 vs S3 vs B2](https://tech-insider.org/cloudflare-r2-vs-s3-vs-backblaze-b2-2026/) ·
[Next.js + Postgres + Docker Compose](https://oneuptime.com/blog/post/2026-02-08-how-to-set-up-a-nextjs-postgresql-redis-stack-with-docker-compose/view) ·
[.travel TLD pricing](https://tld-list.com/tld/travel)
