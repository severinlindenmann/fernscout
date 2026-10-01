# Roadmap — decisions, and what they became

This file is the **decision log**: the calls made in August 2026, before any
of it existed, each now marked **upheld**, **superseded** or **reversed**
against what actually shipped. It is not the backlog — that is
`npm run tasks` (`docs/tasks/`, in the harness this app is dispatched from),
which is where anything still open belongs. The task tables that used to live
here have been moved out or marked done; §15 keeps only what is still
genuinely undecided.

**Section numbers and task IDs are kept even where the work is done**, because
source comments cite them (`ROADMAP §1.1`, `§2.2`, `§3.1`, `decision 24`). A
heading that still exists is a heading a comment can still resolve.

Effort: **XS** under two hours · **S** half a day · **M** one to three days ·
**L** one to two weeks · **XL** a month or more.

---

## 0. Decisions taken

Answered on **2026-08-30** unless noted. A decision log, not a list of forks;
anything still open is in §15.

| # | Question | Status | Decision |
| --- | --- | --- | --- |
| 1 | Departure | Upheld | **~6 months out (≈ March 2027)** — but explicitly *not* treated as the main constraint; agentic development is fast enough that build time isn't the binding limit |
| 2 | Data model | Upheld | **Files canonical + Postgres index** |
| 3 | Licence | Upheld (amended) | **Apache-2.0 + separate trademark policy** since the open-core split (2026-09-25): hosted-only features live in a private repository instead of behind a licence clause. Was PolyForm Shield 1.0.0 before that, and AGPL-3.0 until B652 |
| 4 | Name | Upheld | **`Fernscout`, on `fernscout.ch`** (§11) |
| 5 | Hosted product | **Superseded** | Was "deferred — keep the seams clean, decide after the trip." Replaced by the 2026-09-25 open-core split: the hosted product exists now, as `paid/` (photobook, postcards, WhatsApp, Stripe billing), reached through `@paid/*` — see §12 and `docs/capabilities.md` |
| 6 | Audience | Upheld | **~20–50 readers, most will never install anything → email is the product** |
| 7 | Currency | Upheld | **Local currency in, CHF out, per-trip rates, reader-selectable display currency** |
| 8 | Photobook | Upheld | **Script-first, for me — but must handle low volume (5–10 recipients), books *and* postcards** |
| 9 | Feature model | Upheld | **Every optional capability off by default; enabling one is the self-hoster's act and requires their own credentials. The hosted tier supplies those credentials** (§1.1) |
| 10 | Prototype scope | Upheld | **`fernscout.ch` on the VPS, public site only, no Postgres** (§2.2) |
| 11 | Costs visibility | Upheld | **Per-trip: `public` or `guests`** — set on the trip document (`trip.md` until B1598; `trip.json`'s own field since) |
| 12 | Trip visibility | Upheld (amended) | **Per-trip: `public` / `unlisted` / `password`**. *Amended by B39 and W27: the password is gone — one shared secret was the wrong shape (`lib/access.ts`). It is `public` / `guest` / `private`, and `unlisted` became the separate `listed:` field, which may only narrow (B51).* |
| 13 | Languages | Upheld | **Two layers** — maintained UI locales (de/en/hu/fr/it, English fallback) vs arbitrary content languages (§1.2). Implies `M7` locale URLs |
| 14 | Domains | Upheld | **`.ch` + `.com`** only |
| 15 | Media | Upheld | **VPS disk, behind a media interface**; off-VPS backups regardless |
| 16 | Push | Upheld | **Build it properly** (`D1` + `D7`), despite the audience estimate |
| 17 | Mail | Upheld | **Proton SMTP** (Business plan — also provides the `fernscout.ch` mailbox) |
| 18 | Video | Upheld (amended) | **Short clips only**, hard length cap (5 minutes, raised from an earlier 30-second cap), ffmpeg at ingest |
| 19 | Re-sharing | Upheld (amended) | **Links forward freely, but access needs your approval** — email on each request, plus a guest overview. *Amended by B37: the link has to have been issued by the owner. The open, tokenless one is gone — see §3 and `lib/contacts/invites.ts`.* |
| 20 | Photo consent | Upheld | **Publish, remove on request**, stated in writing |
| 21 | Currencies | **Superseded** | Was "configurable list, ECB reference rates fetched at build time." Replaced: the ECB snapshot is fetched at deploy time and refreshed nightly off the backup timer, not the build — see `docs/currencies.md` |
| 22 | Trademark | Upheld | **Skipped for now** — personal site. Revisit on the triggers in §0.6 |
| 23 | Multi-user | Upheld | **Built in from the start**, not deferred: `content/<username>/…`, URLs at `/@<username>/…`, server config separate from user config (plan W22) |
| 24 | Editing | **Superseded** | Was "the frontend has no editing UI, ever." Replaced by the studio (`/@<user>/studio`): the owner writes in a browser now, with an agent or this instance's own assistant as an optional second way. The three amendments below are kept as history of how that happened. *Amended by B283: the browser still cannot write, and the second half is now narrower than it reads. The owner's own page issues a **20-minute `handover` credential** that can do exactly one thing — be exchanged, once, at `POST /api/auth/handover`, for an agent token of the agent's own.* *Amended again by B619: the owner's own page carries two forms — their own name, telephone and postal address, and the journal's own `title` and `tagline`, through a cookie-only write. Neither is content.* *Amended a third time by B681/B682: a web helper let somebody with no agent of their own write through the same v2 calls. That web room is itself now gone (B311); its job is the studio's own flows.* |
| 25 | Agent doc name | Upheld | **`/documentation.txt`**, not `llms.txt` — named for the person handing over the link. `llms.txt` stays an off-by-default alias. Kept out of search with `X-Robots-Tag: noindex`, never a `robots.txt` rule (plan W23) |
| 27 | No Docker | Upheld | **Native install on the VPS** — Node, Caddy, systemd, and Postgres only when a feature needs it. The backend is Next.js route handlers plus a Node worker; **no second framework** (§2.3) |
| 26 | Landing page | Upheld | **A landing page at `/`** (or `/welcome` when a `defaultUser` owns the root): what this is, how to point an agent at it, and a link to the live `/@example` user (plan W24) |
| 28 | Publishing | Upheld (amended) | **Publish is a separate, explicit call.** Decision 24 said browsers never edit; this says who publishes. What is written still arrives as a draft and cannot publish itself — the two calls exist so the owner can read a day back before anyone else — but putting it up is `PUT .../days/{slug}` followed by its own publish call, owner-only. Supersedes the older rule that a person publishes by deleting `status: draft` from a file (B28, restated B223; B224 dropped a confirmation handshake that never established consent) |
### 0.5 What "clean seams" concretely means

Cheap now, expensive to retrofit. This is the whole cost of keeping §12 alive:

- **Every DB table gets an owner column from the first migration.** Enforced by
  `test/db-migrations.test.ts`.
- Media paths are `<trip>/<…>`, never `public/media/<slug>`.
- Nothing personal in code — `test/depersonalised.test.ts` fails the build.
- Config is data, never constants in `lib/`: server config in
  `site/config.json`, user config in `content/<username>/config.json`.
- Anything a person owns — including generated postcards, books and mail — is
  written under `content/<username>/`, never to a shared directory.

### 0.6 Trademark — deferred, with triggers

Skipped as a personal site (decision 22). Revisit if **any** of these happen:
the public repo makes `Fernscout` a prominent brand rather than a folder name;
anyone pays money — a postcard, a photobook, a hosted plan; or a conflicting
mark turns up in the same class.

Registration is CHF 350–550 for up to three classes and stays available. The
risk of waiting is that someone else registers it first, not that the right to
use the name is lost.

---

## 1. Foundation

### 1.1 Capabilities — everything off by default

Every optional feature ships **disabled**. Turning one on is the self-hoster's
act and requires their own credentials; a hosted tier would supply them instead
(L9). `site/config.json` says *what* is on; `lib/capabilities.ts` decides,
and `/api/health` explains why something is off.

**Off means absent, not broken.** A disabled capability must not render a dead
button, a 500 or a half-page — the feature is simply not there. `components/SiteNav.tsx`'s
costs tab (B165) turns on this rule: with `features.costs` off, the tab is gone
rather than pointing at a page that answers 404.

**Secrets never appear in `config.json`** — SMTP passwords, print-provider keys,
VAPID keys and the cookie secret are environment variables only. A config file
in a public repo is exactly where credentials go to die.

### 1.2 Two language layers

The distinction that makes multi-language survivable (decision 13):

| | **UI / chrome** | **Content** |
| --- | --- | --- |
| What | Menus, buttons, labels, dates, error text | Entry titles and bodies, trip taglines |
| Who provides it | **Maintained**: `de`, `en`, `hu` | The author, in whatever language they write |
| If missing | **Falls back to English chrome** | Falls back to the entry's default text |
| Configurable | The self-hoster picks from the maintained set | Anything — Croatian, Portuguese, whatever |

Nobody has to translate a nav bar to publish a post. A Croatian self-hoster
writes Croatian entries under English menus and it looks deliberate rather than
broken. `lib/locales.ts` and `lib/i18n.ts` hold the split.

### Still open here

| ID | Task | Effort |
| --- | --- | --- |
| **A9** | **Media out of git for large trips.** Half done — originals are gitignored and ingest resizes to ≤2000px. The rest is originals on object storage or a synced folder, which is what makes thousands of photos survivable. | **M** |
| **A8** | **Document the two content modes**: content committed (a personal blog, git is the backup) vs content gitignored on a volume (a hosted instance). Neither is written down. | **XS** |

---

## 2. Architecture & hosting

### 2.2 The no-database tier

**A public journal runs with no Postgres anywhere.** Files are canonical and the
database is an index, so the database is genuinely *optional* rather than merely
deferred — the tier is not a crippled version of the app, it is the same app
with the flags off. If rendering a public page needed Postgres, the architecture
would be wrong.

Reactions and push fall back to a `$DATA_DIR` JSON file (`lib/store.ts`,
`lib/repos/reactionsFile.ts`), which assumes a **single Node process**. Auth,
contacts, digests and guests are what pull a database in — that was B2
(Postgres + migrations, built on Kysely rather than the Drizzle the plan
guessed at) and B3 (the one-shot `.data/*.json` → database import, still
covered by `test/db-import.test.ts`), both landed in W06.

### 2.3 No Docker, and no second backend framework

**Decision 27.** The stack installs natively: Node, Caddy, systemd units in
`deploy/`, and Postgres only once a feature needs it. `scripts/deploy.sh` is a
pull, an install, a build and a restart.

Docker earns its keep when you want a portable artifact built once and run
anywhere. Here there is one machine, built on the machine that serves it. The
cost avoided: a second packaging format to keep in step, image builds in CI, and
a self-hoster needing to understand containers to run a travel blog.

**Next.js already is the backend.** Route handlers under `app/api/*`, server
components reading the filesystem, the Kysely data layer in `lib/db` and
`lib/repos`, boot checks in `instrumentation.ts`. Adding a second language and
runtime would mean models duplicated across two type systems and kept in step by
hand, for nothing.

### Still open here

| ID | Task | Effort |
| --- | --- | --- |
| **M1** | **Backups you have restored from at least once.** The highest-value item in this document. `scripts/backup.sh` and the restore procedure in `docs/runbook.md` exist; performing the restore is the part that is not code. | **S** |
| **M11** | **Storage budget math.** 5 months × ~30 photos/day at 4 MB ≈ 18 GB of originals. Decide what is kept, at what size and where — retrofitting is a migration over hostel wifi. | **XS** |
| **B5** | **CDN / image resizing at the edge.** `/@<user>/media/…` resizes on the VPS, which is fine for family traffic and not for a hosted product. Object storage (B4) is what makes this a config change. | **M** |

**B9 shipped** — the `analytics` feature (a database, no third party) answers
"is push actually used", from the studio's own "Visitors" page.

---

## 3. Access, guests and contacts

### 3.1 One contact record, not three lists

The same person was otherwise asked for the same details three times — once to
be approved as a guest, once to choose notification channels, once for a postal
address. **These are one record**, in `lib/contacts/`:

```
contact
  name, email (identity key), preferred_locale
  postal: name, line1, line2, postcode, city, country   -- optional, encrypted
  wants_email_digest, wants_postcard                    -- explicit, separate
  access grants (trip, level), push subscriptions
  created_via (which invite link), confirmed_at, last_seen
```

Everything downstream reads it: the digest picks `preferred_locale` per
recipient, the postcard script selects contacts with an address, access control
reads the grants. One form, one table, one place to revoke.

**One link shape.** A personal link (`/@<user>/i/<token>`) is one per person with
name and language baked in. There was a second — an open link, one per journal,
pasted into a family group chat and falling back to `Accept-Language` — and
B37 removed it. It granted nothing, which was the original argument for it, but
it advertised a way in the owner had never offered: anybody who found a
username was shown a form, and the owner was left approving strangers. The old
address redirects to `/@<user>/me`, and the endpoint behind the form now
requires a live invite token.

### Still open here

| ID | Task | Effort |
| --- | --- | --- |
| **C8** | **Signed media URLs.** A private trip's photos are served behind the access check, but the URL itself is guessable and unbounded once shared. | **M** |
| **C7** | **Share links with embedded intent** — a link that says which day it opens on and, for a guest, what it grants. | **S** |

---

## 4. Notifications

D1 push, D2 the email digest, D3 the mail transport, D6 the preferences page and
D8 the quiet rules all shipped (W07, W11, W12). What is left:

| ID | Task | Effort |
| --- | --- | --- |
| **D4** | **Native share / `wa.me` button.** The way a link actually reaches family is a share sheet, not a copied URL. | **XS** |
| **D5** | **Telegram bot channel.** Deferred — email and push cover the audience. | **S** |

---

## 5. Photos, geodata & ingest

E1–E3 and E7–E10 shipped in W15: `npm run ingest` reads EXIF, clusters a folder
into candidate days, resizes, handles HEIC and short video, and refuses
duplicates by hash.

**E4 shipped** — `importers/gps/google-timeline.ts` and `google-records.ts`
read a Google Timeline/Takeout export.

| ID | Task | Effort |
| --- | --- | --- |
| **E6** | **Map the real route**, not straight lines between stops. Shipped for the derived line drawn from a phone's own GPS history (`docs/gps.md`); still open for a trip with no recorded history of its own. | **M** |

---

## 6. Live tracking on the phone

**Built, but not the way this section planned.** Rather than a generic
`POST /api/track` any tracker app could post to, the shipped design is the
iPhone shell's own native recorder (`ios/App/App/Recorder.swift`) writing
into a journal's own GPS history, with route rendering, thinning and private
zones all in `docs/gps.md`. A third-party app posting a payload
(**F1**) is still not built and is no longer planned — the native recorder
is the one path.

| ID | Task | Effort |
| --- | --- | --- |
| **F2** | **Manual "check in here" button** — the low-tech version that works without a tracker app. | **S** |

---

## 7. The agentic layer

◆ **This is the part of the plan that isn't a worse Polarsteps.** Competitors own
auto-tracking and travel books, and will not be out-featured on either. What they
structurally cannot offer is: *your content is JSON documents and photos in a
folder you own, and any agent can read and write it.* Lean all the way in.

G1 (skills + `AGENTS.md`), G4 (REST), G5 (MCP), G6 (direct file access) and
**G7 — agent-written content is always a draft** shipped in W18 and W23. *G5 was
removed 2026-09-04 (B298) — no client was exercising it, and it cost real
maintenance surface. REST (G4) is the only agent-write door now; MCP may come
back if a real client shows up.* G7 is
enforced in `lib/entries.ts` and is not a setting. What it means changed in
decision 28: a draft is the state a day is written into so that somebody can
read it back, not a lock only a person can open. Publishing is an agent call
now — B28 built it, B223 restated the rule around it, B224 took the
confirmation handshake back off.

| ID | Task | Effort |
| --- | --- | --- |
| **M3** | **A "what I'll actually do each night" ritual, designed and timed.** If it takes more than ~10 minutes it will not happen in month three, and nothing else here compensates. Ingest and the skills exist; the ritual around them has never been run against real tiredness. | **S** |
| **M2** | **Offline-first writing.** Draft an entry, attach photos, queue the upload, sync when there is wifi. Without it the workflow breaks exactly where it is used. | **L** |
| **G2** | **Voice-memo → entry pipeline.** A recording becomes a drafted day. Design it on the road (§14), not before. | **L** |
| **G3** | **Interview mode** — the agent asks about the day rather than waiting to be dictated to. | **M** |
| **G8** | **Cost extraction from receipts** — a photographed receipt becomes a `costs:` line. | **M** |

---

## 8–9. Print and presentation

Both shipped. **Postcards and photobooks are hosted edition only** — the
renderer, PDF/X handling and a `dry-run` backend for every provider (W13/W14)
now live in the private `paid/` repository; the provider detail that used to
sit here lives with their own provider docs. Presentation mode, the narrated
cut and the wake lock are open and are W19.

| ID | Task | Effort |
| --- | --- | --- |
| **I3** | **Export the slideshow to video/GIF.** | **M** |

---

## 10. Quality, bugs & the audit

The four measured problems that used to live in `TODO.md` were all fixed —
SCALE-1 (the whole trip serialised into one client tree) is windowed in
`lib/tripView.ts`; OPS-1 is gitignored originals plus resize at ingest; PERF-1 is
the dynamic import in `components/useWorldLand.ts`; TEST-1 is the suite under
`test/`. That file was folded into this one on 2026-08-31; J7–J11 are what it
measured and left behind.

**J7 shipped** — `rfc822()` (`lib/feed.ts`) now reads a day's own `timezone`
(or the journal's), through `zonedTimeToUtc`, rather than stamping
`T00:00:00Z`.

| ID | Task | Effort |
| --- | --- | --- |
| **J8** | **The service worker's two remaining gaps**, both documented at `public/sw.js:31`. The runtime cache is trimmed by insertion order rather than use — right on a five-month trip, but a guess, and a real LRU needs timestamps the Cache API does not keep. And nothing is precached per journal: the worker installs from whichever page the reader opened and cannot know whose journal it is about to serve, so a trip's first day is always a cold fetch. | **M** |
| **J9** | **Done — B770.** By 2026-09-07 the top bar had grown to four stacked rows on a phone (a back link, the title, three chips, seven nav icons — 121px of sticky header where 61px was meant), worse than the two rows this entry originally measured. Below `sm` it is now one row — back, the journal's title, the current section's own icon (the same `yellow-400` waymark the tab bar already used, so "where am I" survives the collapse), and a menu button — with the trip/currency/language chips and the seven destinations moved into a panel behind it (`components/SiteNav.tsx`'s new `list` variant, reused rather than redrawn). Measured at 390px on `/@example`: header height 121px → 65px closed (a 46% cut), every control in the header and the panel ≥44px tall including the panel's own rows (48px). The panel sits in the flow rather than over it, the same call `ConfirmPanel` makes — Escape and a tap outside both close it, and focus moves into the panel on open and back to the button on every way it closes. `sm` and up are unchanged. See `components/PageHeader.tsx`. | **S** |
| **J10** | **Swipe navigation on mobile.** The reading model is one screen at a time, which is exactly the model people swipe; on a phone the only way forward is still the button. `motion` is already a dependency — `drag="x"` on the `motion.div` in `components/StoryPager.tsx` plus a threshold, wired to the same `goStep` the buttons call. | **S** |
| **J11** | **"Since you last visited" counts by entry date, not publish date.** Backdating an entry will not announce it. Needs a separate `published:` field if days stop being written up in order. | **S** |
| **J3** | **Playwright smoke suite** — walk the pager, run axe on each route. The unit layer under `test/` does not cover the browser. | **M** |
| **J1** | **Manual desktop + mobile audit**, written up with screenshots: iPhone SE / Pro / iPad / 1440px desktop, both orientations, Safari + Chrome + Firefox. | **M** |
| **J2** | **Accessibility pass aimed at the actual audience**: 60+ readers on phones. 16px body minimum, tap targets ≥44px (J9), contrast ≥4.5:1 (guarded by `test/contrast.test.ts`), no hover-only interaction. | **M** |
| **M14** | **Retro/archive mode** — freeze a past trip's route and costs so a rebuild years later renders identically. | **S** |

---

## 11. Brand, name & domain

`fernscout.ch` is decided (decision 4) and the waymark, palette and wordmark
shipped in W01/W25 — see [`docs/branding/BRAND.md`](branding/BRAND.md) and the
`apply-the-brand` skill.

| ID | Task | Effort |
| --- | --- | --- |
| **K2** | **Trademark search on `Fernscout`** — Swissreg, DPMA, EUIPO — before money goes into it, and professionally if the hosted product happens. One free database check is the cheap version and the only thing that would change the name. | **S** |
| **K3** | **Defensive TLDs** — `fernscout.com` / `.de` / `.at` (~CHF 30/yr), redirected to `.ch`. `.de` needs an admin-c with a German postal address. Cheap now, expensive once someone else takes them. | **XS** |
| **K7** | **Mail domain setup** — SPF, DKIM and DMARC for the sending domain. Deliverability, not a feature. | **S** |

---

## 12. The hosted product

**Live** — decision 5 is superseded (above): the open-core split shipped this
as the private `paid/` repository, reached from the app only through
`@paid/*`. Signup (`features.signup`), plans and Stripe billing
(`@paid/billing`), storage quotas (`lib/storageQuota.ts`),
and delete/export on request (`lib/contacts/index.ts`, `npm run export`) are
all built — **L2** and **L5** below, done. What is still open is the
positioning and go-to-market work, not the platform.

> **The travel journal your AI can actually use.** Your trip is JSON and
> photos in a folder you own. Talk to it, write it by voice, export it, print
> it, self-host it. No lock-in, no feed, no algorithm.

The proof points are all things a closed competitor structurally cannot say:
open API, plain-file export, free self-hosting of an open-source codebase,
and "your data leaves as easily as it arrived."

| ID | Task | Effort |
| --- | --- | --- |
| **L10** | **Custom domains per customer** — Caddy on-demand TLS, gated by an authorisation endpoint so anyone pointing DNS at you cannot mint certificates. The single most visible thing the hosted tier sells. | **M** |
| **L9** | **Managed credentials** — the hosted tier supplies what a self-hoster brings: SMTP, print keys, VAPID. `lib/capabilities.ts` resolves them from the platform instead of the environment; same code path, different source. | **M** |
| **L3** | **Onboarding that produces a first day within 5 minutes.** Upload ten photos, get a drafted day. Longer than that and nobody comes back. The studio's own guided photo import (`extract`) is the mechanism; whether it lands under 5 minutes for a new signup is unmeasured. | **L** |
| **L4** | **Abuse & moderation.** Public pages mean spam, illegal content and DMCA. Have a takedown path before launch, not after. | **M** |
| **L6** | **Docs site + a 3-minute self-host video.** For an OSS project, docs *are* the marketing. | **M** |
| **L7** | **Launch plan** — Show HN, r/selfhosted, Product Hunt, and the strongest one: a genuinely good write-up of a real 6-month trip as the reference instance. Ship the product by shipping the trip. | **M** |
| **L8** | **Migration importers** from Polarsteps / FindPenguins exports. The cheapest acquisition channel and directly on-message about lock-in. | **M** |

L1 (multi-tenant routing) is done — built as decision 23 rather than deferred here.

---

## 13. Cross-cutting

M4 search, M5 RSS, M6 export, M12 the config upgrade path and M13 the project
scaffolding all shipped. **M7 locale URLs** was resolved differently from the
plan: rather than a `/[locale]/…` segment on every route, language is a shareable
`?lang=` parameter set by `proxy.ts`, so translated pages are linkable without
touching every route. (It was also advertised as `hreflang` from the sitemap
until B2486: a `?lang=` page canonicalises to the bare URL, so `lib/sitemap.ts`
now lists no language alternates until languages have paths of their own.)

| ID | Task | Effort |
| --- | --- | --- |
| **M8** | **Photo policy, in writing** (decision 20): a plain line saying these are personal travel photos and anything will be taken down on request, with a working contact address. | **XS** |
| **M9** | **Safety features**: live location shared with two trusted people, and an emergency documents page (insurance, passport scans) only the owner can unlock. | **M** |
| **M10** | **Guestbook / comments with moderation.** Reactions cover the cheap version; free text needs a moderation story first. | **M** |

---

## 14. Sequencing

Everything through W36 has merged, so what is left is two groups rather than a
wave plan.

**Before the trip.** `M1` a restore you have actually performed · `M3` the
nightly ritual, designed and timed · `K7` mail domain records · `A9`+`M11`
storage decided before there are thousands of photos · `J7`–`J11` the measured
quality items · `M8` the photo policy.

**On the road.** `G2`+`G3` voice-memo and interview mode, designed against actual
tiredness and actual wifi · `F1`–`F4` tracking · `M2` offline writing. Do **not**
plan a refactor here.

Everything else — the hosted product, defensive domains, analytics, the
guestbook — waits for a reason to exist.

---

## 15. Still open

### Mine to resolve

| | Item |
| --- | --- |
| **H10** | Spike the Swiss Post PostCard Creator API — does it still work, what is the current free-card allowance? Timeboxed to an afternoon; abandon rather than fix someone else's reverse-engineered auth. |
| **K2b** | One free trademark database check (Swissreg / DPMA / EUIPO) for a conflicting `Fernscout` in the same class. |

### Becomes a question later

| | Trigger |
| --- | --- |
| **A journal-level authentication wall** | If somebody wants a journal a stranger with the URL cannot read *at all*. W38 gave a journal `visibility: "guest"` (the value is `guest`; `private` never shipped and is not in the schema), which means unlisted — off `/documentation.txt`, off the landing page, off the sitemap, `noindex`. Who may read a *journey* is still the trip's own gate, which already has approved readers of the journal and the trip's own `people:` list. A real wall above that touches every page, the feed, the search index, the export, the media route and the markdown twins, and needs an invite flow at journal level. Do not half-build it: a gate that looks stronger than it is, is worse than none |
| **Trademark registration** | Any of the three triggers in §0.6 |
| **Object storage** | When the VPS disk hurts. `lib/media.ts` is what makes it a config change |
| **`.de` / `.at` domains** | If DACH readership grows beyond family, or someone else takes them |
| **Transactional mail provider** | If Proton SMTP shows bounce or deliverability problems |
| **Hosted product** | After the trip (decision 5), and everything in §12 with it |
| **Native app** | Only if paying customers ask. The answer today is no |

### Assumptions worth checking against reality

- **Does the nightly ritual actually take under 10 minutes?** (M3) If not, little
  else here matters.
- **Do ~20–50 readers turn out to be right?** Decision 6 drives the whole
  notification design; the first month will tell.
- **Is push actually used?** Decision 16 kept it against the read of the
  audience. Instrument it (B9) rather than argue about it.

---

## Sources

Kept where the research is still load-bearing. The domain-availability and
print-pricing snapshots were August 2026 and have aged out.

[OAuth 2.1 for remote MCP servers](https://mcp.directory/blog/oauth-21-for-remote-mcp-servers-streamable-http-explained-2026) ·
[PWA iOS limitations](https://www.magicbell.com/blog/pwa-ios-limitations-safari-support-complete-guide) ·
[Telegram Bot API](https://core.telegram.org/bots/api) ·
[Proton SMTP setup](https://proton.me/support/imap-smtp-and-pop3-setup) ·
[osxphotos](https://github.com/RhetTbull/osxphotos) ·
[Google Timeline export](https://discoveryengineering.net/blog/google-takeout-location-history/) ·
[Swiss Post PostCard Creator API](https://developer.post.ch/en/technical-specifications-of-postcard-api) ·
[PDF/X print-ready standards](https://img.ly/blog/what-does-print-ready-pdf-mean-understanding-pdf-x-standards-for-professional-printing/) ·
[Swissreg trademark database](https://www.ige.ch/de/uebersicht-dienstleistungen/digitales-angebot/datenbanken-und-verzeichnisse/swissreg/markendatenbank) ·
[DENIC .de requirements](https://www.denic.de/en/products/de-domains/registration/)
