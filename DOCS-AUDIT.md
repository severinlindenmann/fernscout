# Documentation audit — 2026-09-25

Scope: every `*.md` in the repo (README, AGENTS, CONTRIBUTING, NOTICE,
TRADEMARK, BRAND-LICENSE, `docs/**`, `importers/README.md`), the agent-facing
text served by the app (`/documentation.txt`, `/skill/*.md`,
`lib/api/skillDocs.ts`, `lib/api/agentCopy.ts`, `lib/api/documentation.ts`,
`lib/api/errorCodes.ts`, OpenAPI examples), the UI strings in
`site/locales/{en,de,hu}.json`, and the legal pages in `site/legal/`.

Method: each claim was checked by reading the code (no `node_modules`, so
nothing was run). Items marked ✔ were re-checked by hand after the first
pass. Everything else is cited to `file:line` so it can be verified quickly.

Findings fall into four groups:

- **Part A**: problems in the code itself that the audit surfaced.
- **Part B**: rules in AGENTS.md that are false as written.
- **Part C**: wrong statements, file by file.
- **Part D**: wording that differs across docs, and decisions needed before
  the rewrite.
- **Part E**: suggestions for the overhaul itself.

---

## Part A — Code bugs found while checking docs (fix before or with the rewrite)

These are not doc errors. In each case the doc describes the intended
behaviour and the code does not match it.

1. ✔ **The operator's admin cookie can read and overwrite any journal's
   private GPS zones (home coordinates).** The route is
   `app/api/web/[user]/gps/zones/route.ts:23`; it guards with `isOwner`, which
   admits `isAdminEmail` (`lib/contacts/session.ts:49`).
2. ✔ **The admin cookie can import or discard any journal's GPS history.**
   `app/api/helper/[user]/import/route.ts:55` guards with `isHelperOwner`,
   which admits admins (`lib/helper/caller.ts:41`). This contradicts the
   studio's own claim that "every `gps/` door refuses the admin"
   (`app/[user]/studio/location/page.tsx:52-55`). `helper/[user]/gps/*` and
   `day/place` add an `owner.email` check; these two do not.
3. ✔ **A day with no `status` is treated as published.**
   `lib/entries.ts:511-513` counts only `"draft"` as a draft, but README
   says only `"published"` publishes. A hand-copied example day without the
   field goes public. Either fix the default or fix the README.
4. ✔ **`deploy/fernscout-worker.service:20` runs `npm run worker`, which does
   not exist.** Enabling the unit, as its header says to, produces a restart
   loop.
5. `scripts/install-units.sh:110` installs paid units from `$UNIT_SRC`
   instead of `$PAID_UNIT_SRC`.
6. **Caddy caps an upload route at 10 MB.**
   `app/api/web/[user]/figures/from-photo/route.ts:67` accepts
   multipart uploads of up to 50 MiB, but it is missing from `@bigbody` in
   `deploy/fernscout.caddy`.
7. **A journal PATCH silently resets `defaultLocale` to `locales[0]`**
   (`lib/journals.ts:1393-1398`). Create stores `defaultLocale`
   separately, so a journal made with `defaultLocale:"de", locales:["en","de"]`
   flips to English on its first title change.
8. **The `costs` capability is not enforced on v2 statement reads or on
   `costs/apply`** (`app/api/v2/[user]/statements/[src]/route.ts`,
   `…/costs/apply/route.ts`). With costs off, the feature is still reachable,
   not absent.
9. **The v2 `/track` route sends a false public message.**
   `app/api/v2/[user]/trips/[trip]/track/route.ts:94-97` says "any existing
   one was left alone", but an empty derivation deletes `track.json`
   (`lib/gps/api.ts:384-386`).
10. **The `buddies` `to_provide` hint names a call that does not exist.**
    `lib/api/v2/incomplete.ts:44-49` tells agents to `POST /invites`, but
    only `PUT /invites/{id}` exists.
11. **Agent-facing error texts name fields and routes that don't exist.**
    They are served as `message` and used as OpenAPI examples:
    - `expected_urls` says `urls`; the field is `url`.
    - `invalid_translations` points to `PATCH …/config`, which does not exist.
    - `invalid_cover` points to `…/trips/{trip}/media`, which does not exist.
    - `unknown_day` says "the slug is made from the title"; the client
      chooses it.
    - `stale_document` says `details.current`, but trips and days send the
      document itself.
    - `incomplete_day` uses the v1 `"costs": false` encoding.
    - `invalid_rates` has the wrong rate direction.

    All in `lib/api/errorCodes.ts`.
12. **Things that should be absent when off are still rendered.**
    - `components/ContactManage.tsx:350-380` always shows postcard and
      WhatsApp opt-in checkboxes.
    - `fulfilmentRelay` with a `url` resolves as *enabled* in the open build
      (`lib/capabilities.ts:524-537`).
    - `landing.hostedIn` ("Hosted in Europe") and `landing.publicNone` (a
      developer instruction) render on any instance.
13. **Operator-specific text ships in the open locales.**
    - `agent@fernscout.ch` appears in six strings.
    - "Swiss (+41) numbers only" is hard-coded, although it is config.
    - "Fernscout" is hard-coded where `{site}` exists.
    - The committed `site/legal/{en,de}.md` names a specific operator's
      hosting (Hetzner, Proton, Stripe).
    - `site/config.json` `site.credit.url` is not a valid URL.

    `test/depersonalised.test.ts` does not scan `site/locales`.
14. ✔ **The photo visibility chip says "Just me" for `private`.** `private` is
    the owner plus the people on the trip (`lib/photos.ts:35-43`).
15. ✔ **The signup wizard's `agent.visibilityGuest` says "only people you
    invite can read it".** A guest journal is "unlisted, not locked"
    (`lib/api/v2/schemas/journal.ts:55-57`).
16. ✔ **Statement consent understates what is sent.**
    `agent.statementConsentLabel` says "column headings", but the header plus
    five sample rows go to the model
    (`app/api/helper/[user]/statement/route.ts:19-20`).
17. ✔ **An English string contains German.** `agent.tool.addPhotosPane` says
    "the **Dateien** tab".

---

## Part B — AGENTS.md rules that are false as written

AGENTS.md is the contract every agent reads first, so each of these misleads
every session.

| Rule | Reality |
| --- | --- |
| "a delete API call creates a confirmation email and removes nothing" | Only journal and trip DELETE do this. Day (draft) DELETE removes immediately (`…/days/[slug]/route.ts:452-474`). Media `{src}`, figures, contacts, invites, inbox and owner/tel DELETEs also remove directly. The studio deletes a trip after a ConfirmPanel with no mail (`components/DeleteTrip.tsx`). |
| GPS raw store readers are "gated behind its own feature flag and reachable only from the owner's own browser cookie — never from a bearer token" | These take bearer tokens and have no flag: `POST /api/v2/{user}/import` (owner or `write:gps` token), `POST …/trips/{trip}/track` (reads via `readRange`), `GET /api/v2/{user}/gps` (lists months), and `GET/PUT …/gps/zones`. The flagged doors share one flag (`routeRecording`), which also gates the recorder UI. Two cookie doors admit the admin (Part A 1–2). |
| "Every optional capability is off by default" | `signup` has no switch and is on wherever a DB and `SESSION_SECRET` exist; `inviteOnly` is the real gate (`lib/config.ts:547, 941-955`). |
| "No feature requires a paid provider account to develop or test" | `helper`, and therefore `extract`, need `ANTHROPIC_API_KEY` and have no dry-run backend (`lib/capabilities.ts:127-155`). |
| "guided web/WhatsApp helper" for people with no agent | The web helper room (`/agent`) is retired, and WhatsApp is hosted-only. What the open edition has is the studio plus the `helper` capability (polish text, describe photos). |
| "A day is composed … nothing is composed for them" | `write-day` returns model-written prose from notes for review (`app/api/helper/[user]/day/write-day/route.ts`). README, BRAND.md and `landing.*` pitch "an agent writes the day". Decide the story. |
| `npm run verify` is the gate an agent runs | For callers without a TTY (i.e. agents), `scripts/verify.mjs:65-85` refuses unless `VERIFY_WILL_WAIT=1` or `CI` is set. AGENTS.md doesn't say so. |
| Hosted-only features are "never part of this codebase" | `package.json` keeps seven `paid/` scripts. They print "not included" and exit 0. `stripe` is a runtime dependency, and `vitest.config.mts` includes `paid/test/**`. These are intentional shims, but undocumented. |
| "A link never carries access on its own" | An invite created with `email` pre-approves that address (`schemas/social.ts:25-26`). `me.askOwner` also says "the link they send you is what lets you in". |

Also: `test/depersonalised.test.ts` and `test/docs-links.test.ts` quote AGENTS.md
text that is no longer in it ("source, fixtures, config or task files",
"indexed from the README", …). So do many `docs/testing/**` files and three
test comments ("AGENTS.md decision 24", "AGENTS.md §1.2").

---

## Part C — Wrong statements, by file

### README.md
- ✔ **L107-108**: "Only `"status": "published"` puts a day on the site". The
  code does the opposite (Part A 3).
- **L1**: the hero alt text "news from far away, arriving at home" is the
  retired "Reisepost" meaning, per BRAND.md:14-18.
- **L72-73**: "every provider has a dry-run mode". False for `helper` and
  `extract`.
- **L127-133**: lists credits as hosted-only. The credits ledger and spending
  are open (`lib/credits.ts`); only *buying* them (Stripe) is hosted.
- The README never mentions the studio, which is the primary way to write.

### CONTRIBUTING.md
- **L3**: "markdown entries". Entries are JSON.
- **L30**: `docs/plans/INDEX.md` does not exist.
- **L38-51**: describes an AGENTS.md "startup section" and "Skills catalog",
  and `.claude/skills/` exposed via `.agents/skills/`. None of these exist.
  `.claude/` is gitignored. The same dead reference is in `knip.jsonc`,
  `test/docs-links.test.ts` and BRAND.md:133 (the `apply-the-brand` skill).
- **L63**: "CI runs the same checks". CI runs them as parallel jobs.
  Typecheck uses `npx next build`, and the final `build` job doesn't depend on
  `unused` (knip).
- **L102/121**: "License" vs "Licence" everywhere else.

### NOTICE / BRAND-LICENSE / TRADEMARK.md / branding
- **BRAND-LICENSE:6-8**: refers to a "carve-out in `LICENSE`". `LICENSE` is
  plain Apache-2.0. All 13 brand SVGs, `app/icon.svg` and
  `scripts/render-avatar.mjs` say "see the BRAND ASSETS section of LICENSE",
  which doesn't exist; the text is in BRAND-LICENSE.
- **TRADEMARK.md:83-85**: "first commit `8089d55d`" is not in this history.
  The first commit is `54ebfee`.
- **NOTICE:10-36**: cites `scripts/build-peaks.mjs` (it is `.ts`) and
  `lib/photobook/strings.ts` (moved to paid). The GeoNames, OSM and Natural
  Earth attribution strings are no longer in the open code.
- **BRAND.md:165-168**: the `path-pulse` "house animation" is defined but used
  nowhere, and its glow is yellow, not green.
- **BRAND.md:17**: "the product actually is … an agent that hands it back
  written". This conflicts with AGENTS.md.

### .github / knip / tests
- `.github/workflows/ci.yml:39`: "the other four jobs"; there are five.
- `ci.yml:78-82`: cites `docs/plans/W06-data-layer.md` and says "until the
  data layer lands". `lib/db` has landed.
- `ci.yml:121-125`: `scripts/agent-context.mjs` and
  `test/agent-efficiency-tools.test.ts` do not exist.
- `ci.yml:190`: `backup.sh:252` is the wrong line.
- `knip.jsonc:3`: "the four checks in AGENTS.md"; there are five.
- `test/fixtures/roadmap-tasks/` is referenced by nothing.

### docs/README.md
- **L37-38**: "`test/docs-links.test.ts` fails the build when a cited file
  does not exist". This overstates it in four ways:
  - It is a Vitest test, not part of the build.
  - It checks only `[link](…)` syntax inside `docs/`; backtick paths are not
    checked.
  - It doesn't scan `components/`, `proxy.ts`, `instrumentation.ts` or
    `next.config.ts`.
  - It silently passes anything pointing into a removed `plans`, `tasks`,
    `qa` or `v2-migration` directory.

  That is how every dead path in this report survived.
- **L39-41**: calls `architecture.md` "the strongest". It has about eight
  dead paths (below).
- **L43-44**: calls the decision log "durable". Decision 24 is reversed, and
  code cites decision numbers from a different, missing log (see ROADMAP).
- **L48-50**: "Hosted-only features … are not documented here". They are:
  in helper.md, capabilities.md, running-locally.md, disaster-recovery.md and
  five testing flows.
- **L16**: statements "take two calls". statements.md says three.

### docs/architecture.md
- **L43**: `/agent` web helper. It is retired; `app/agent.md` 301s to
  `/documentation.txt`.
- **L56**: the "surviving `/api/v1` routes". There is no `app/api/v1`.
- **L62, 65, 66**: `lib/photobook/`, `lib/postcard/`, `lib/stripe.ts` and
  `lib/contentModel/` do not exist; they are `@paid/*` stubs or
  `app/content-model.json` (a 410).
- **L100**: `MiniMap.tsx` was replaced by `TripMap.tsx`.
- **L39**: invite and `/c`, `/u` paths are listed at the root. They live
  under `/<user>/`. The sign-in pages `/s/…` are missing.
- **L40, 61**: the "personal" invite kind was retired.
- **L59**: "entry markdown". It is JSON.
- **L64**: cites an AGENTS.md section that doesn't exist.
- **L67**: GPS store "reachable from nothing under `app/`". Three doors
  import it.
- **L73**: "Three credentials" heading, but four are described.
- **L12-16**: "nothing authoritative in the database". Credits, the ledger,
  analytics and contacts exist only in the DB.

### docs/capabilities.md
- **L3-4, 23-33**: "off by default", and `signup` is listed as a switch. See
  Part B.
- **L13-14 (Rule 2)**: "a journal can switch things off for itself". This is
  true only for `mail`, `whatsapp` and `whatsappInbound`. Almost everything
  else is in `OPERATOR_ONLY_FEATURES` (`lib/config.ts:107-166`), where the
  journal flag is ignored. `extract`, `routeRecording` and `mapRelief` are the
  opposite: a journal must switch them *on*.
- **L33, 51**: only `logging` and `credits` are marked "(operator only)".
- `applePush` is missing entirely.
- **L26**: signup "needs mail". It doesn't; the `phoneBackend` requirements
  are what is missing from the doc.
- **L50**: `extract` is described as reading statements. It is the photo
  import; statements are gated on `helper`, or on nothing in v2.
- **L65-77**: the "not included in this build" boot error applies only to
  the four `PAID_FEATURES`. `mapRelief`, `fulfilmentAccept` and
  `fulfilmentRelay` behave differently.
- **L31**: `addressLookup` needs `ADDRESS_LOOKUP_API_KEY` for any provider
  other than photon.

### docs/currencies.md
- **L73-93**: `site.manualRates` was retired (B1666); the schema rejects it.
- **L73-75**: calls the rates cache "committed". L58-59 of the same doc says
  it is not in git.
- **L17-19, 38-41, 147-149**: trip rates are not "frozen". Unfrozen ECB
  currencies convert at today's snapshot and move nightly
  (`lib/trips.ts:517`, `test/currency.test.ts:352`).
- **L101-103**: says "ECB history". Only the current snapshot is used.
- **L110-118**: `fillTripRates` skips ECB currencies. The `/agent` rates
  tool does not call it. There is no automatic fill:
  `fillTripRatesQuietly` is unused. The UI string `cost.unconverted` ("fill in
  on their own within a day or so") is false for the same reason.
- **L152-153**: names the wrong test file.
- **L44, 179**: "`site.displayCurrencies`" and "the site's baseCurrency" are
  journal config, not site config.

### docs/statements.md
- **L219-224**: documents the response as `spending.days`, `skipped`, etc.
  The wire shape is `{merchants[], payments[], rates, dateRange}`, and
  `skipped` is dropped (`lib/api/v2/schemas/statement.ts:9-33`).
- Doesn't mention the studio path (`/studio/statement`), which sends five
  sample rows to the model.

### docs/gps.md
- **L24-28**: "one named exception, `placeForDay`". There are three
  (`test/gps-store.test.ts:248-261`). The doc also says "two" at L297 and
  "three" at L331.
- **L93**: `POST /api/v1/…/track`. It is v2.
- **L60**: `dryRun` is a query parameter, not a body field.
- **L63-64**: "Owner only". `write:gps` tokens are accepted too.
- **L79-80**: "drop a file in and it works". It must be added to
  `GPS_IMPORTERS`.
- **L81-85, 43**: `--dry-run` and "its own command" refer to a CLI that
  doesn't exist.
- **L195-198**: "config.json goes into every export, including the anonymous
  one". The anonymous export was retired. The same stale text is in
  `lib/gps/enrich.ts:50-53` and `store.ts:24`.
- **L217-218**: `homeDeclined` alone is refused, because `zones` is required.
  PUT also requires `If-Match`.
- **L270-273**: "today" is UTC+14, not UTC. `deriveTrack` uses per-day
  timezones.
- **L327-329**: "no live tracking". The native route recorder exists.
- Smaller:
  - "500 points" (here) vs "a few thousand" elsewhere.
  - "Import is the only automatic re-derive"; `deleteTripRecording` also
    re-derives.
  - `readerTrack` users are incomplete.
  - The `isHelperOwner` gate is named without the owner-email check.

### docs/ingest.md
- **L48, 104**: says a 30-second video cap. The cap is 300 s
  (`lib/ingest/video.ts:29`).
- **L72-80**: "originals stay where you keep them". Ingest always copies
  them into `trips/<trip>/originals/`.
- **L73**: `MEDIA_ORIGINALS_DIR` is "reachable by no route". Owner export
  and sync include originals.
- **L213**: cites an AGENTS.md section that doesn't exist.
- ✔ The ingest CLI prints "delete its `status: draft` line to publish"
  (`scripts/ingest.mts:178`). That contradicts decision 28 and JSON.

### docs/helper.md
- **L14 "The helper is WhatsApp" / L24-26**: WhatsApp can't be turned on in
  the open edition. The open `helper` capability (polish text, describe
  photos, undo) isn't mentioned.
- **L69**: "a journal is markdown". It is JSON.
- **L176-182**: "no photo import path except…". The studio photo import
  exists.
- **L54-55**: "ask wherever you found this project". `/docs/helper`
  hard-codes the repo URL.
- **L5-6**: cites "ROADMAP decision 24, as amended 2026-09-24". No such
  amendment exists.

### importers/README.md
- **L13-22**: `costs` is not an import kind: `IMPORT_KINDS = ["gps","contacts"]`.
  Costs go through media plus `/statements`. `contacts/` is missing from the
  tree.
- **L89-90**: "both schemas, under 150 lines". There are three, totalling
  about 460.
- **L94, 108**: `--format` is a CLI flag that doesn't exist. The same stale
  wording is in `importers/schema.ts` and `importers/gps/schema.ts`
  ("npm run gps").
- **L17-18**: `costs/` also has `revolut-account.ts` and `mapping.ts`.
- **L126-128**: `.jsonl`/`.ndjson` can't be staged; they are not in the inbox
  allowlist.

### docs/running-locally.md
- **L216-241**: the edited `/tmp/fs-site/config.json` is never read, because
  nothing points `FERNSCOUT_CONFIG` at it. `auth` and `contacts` are
  operator-only, so "on in both files" is wrong.
- **L247-251**: "not enabled by example" can't happen for contacts, and
  `/example/contacts` is a redirect, not a 404.
- **L149-152**: enabling `photobook` in the open edition fails the boot.
- **L201**: `npm run credits -- grant` is a paid no-op.
- **L132-133**: there is no credits page.
- **L258-259**: omitting `for` gives `invalid_request`, not a read code.
- **L193-196**: `for:"write"` from a stranger gives 403, not 202. The same
  error is in `deploy-mail.md:240`.
- **L84-88**: with `auth` on and no secret, the server refuses to boot. The
  doc says "no crash".
- **L113**: "`content/config.json`". It is `site/config.json`.
- **L346-347**: the "live ECB flake" was fixed with a fixture.
- **L292**: "nine skills". The open edition serves seven.
- **L134-136**: "no env var makes you an owner". `FERNSCOUT_ADMIN_EMAIL`
  and `AUTH_DEV_CODE` both do.
- **L392**: "content belongs in git". The runbook says content lives
  outside the repo.

### docs/runbook.md
- ✔ **L1088**: after a config-only change, `deploy.sh` restarts nothing when
  HEAD is unchanged (`scripts/deploy.sh:388-395`), so the advice never
  applies an env change. L640 of the same doc uses a bare restart.
- **L432-439**: `.deploy-state` is described as the source of truth. It is a
  fallback; `/api/health`'s commit is the source (L371 of the same doc says
  so).
- **L601-603**: `check:caddy` runs only when Caddy files change, not "every
  deploy". The same error is in `deploy/fernscout.caddy:19-22`.
- **L379-388**: the steps table misses `package.json`, migrations and unit
  changes, which trigger a build or restart.
- **L144, 166, 382, 442**: `site/rates/` moved to `$DATA_DIR/rates/`
  (B1084).
- **L884-899**: backup failure on an unreadable `DATA_DIR` file is pre-B653
  behaviour.
- **L1050-1052**: the snapshot contents are stale; it is now the allowlist
  `db/ content/ config/ state/ env/`.
- **L843-846**: success mail was removed (B1085). The same stale text is in
  `alert.sh:7-8` and `.env.example`.
- **L1012-1023, L697**: the public `/api/health` `backup` block has only
  `state` and `maxAgeHours` without `HEALTH_TOKEN`.
- **L673-683**: the reason text is "not enabled on this server".
- **L686**: 503 also means the content root is unreadable.
- **L45, 227**: the worker unit (Part A 4).
- **L44**: Postgres "only for auth, contacts, postcards". It is any
  `db: true` capability, and SQLite is accepted.
- **L639, 1085**: `db:import` copies; it doesn't move.
- **L60 vs 656**: the service user home is created in a way the same doc
  later calls a bug.
- **L612-614 vs 257-275**: "match PORT in reverse_proxy" vs "do not edit the
  caddy file".
- **L524-526 vs 299**: ufw closes port 80, but ACME HTTP-01 needs it.
- **L148 vs 161**: "CONTENT_DIR holds only journals", yet legal, `.cache`
  and `.registry` also live there.
- **L856, 935**: use `scripts/restic.sh`, not bare restic. A root-run restic
  leaves locks.
- **L662**: "no backups, by decision". Superseded.
- **L722**: under `FERNSCOUT_CONFIG=$DATA_DIR/config.json`, editing
  `site/config.json` has no effect. The same error is in `deploy-mail.md:26,
  184` and `deploy.sh:344, 676`.
- `deploy/fernscout.service:14`: the `Documentation=` URL points at the old
  `…/travel` repo.
- `deploy/fernscout.caddy:120`: refers to the trip-password limit, retired
  in B39.
- `deploy/Caddyfile:24` and `.env.example`: Caddy variables go in the
  `systemctl edit caddy` drop-in, not the app env.
- `.env.example:17-21`: uses container `/data` language.
- `backup.sh:17, 201`: the restore procedure moved to
  disaster-recovery.md.
- Not documented anywhere:
  - The build waits indefinitely while free memory is under 4 GB
    (`FERNSCOUT_MIN_FREE_GB`).
  - The nightly backup unit also sends reminders; disabling it silently
    stops them.

### docs/disaster-recovery.md
- **L112-113, 125-130**: the SQLite file (`$STAGED/db/fernscout.db`) is
  never restored by any step.
- **L94, 134**: step 0 (runbook steps 1–5) installs no units or Caddy, so
  step 7 fails.
- **L114**: `createdb … || true` hides a missing Postgres or role;
  `pg_restore` then fails.
- **L79**: originals under `MEDIA_ORIGINALS_DIR` are never backed up. This
  is a silent data-loss gap.
- **L80**: `config/config.json` is `$DATA_DIR/config.json`, not necessarily
  `FERNSCOUT_CONFIG`.
- **L98 vs 121, L168**: the environment variable lists don't agree, and the
  drill's `sudo -E restic` runs with no environment.

### docs/deploy-mail.md
- **L30-32, 72-74**: "mail is the only mute; contacts is an ordinary
  opt-in". `whatsapp` and `whatsappInbound` are also journal channels, and
  contacts is operator-only.
- **L195**: `smtp.ts` is 345 lines, not about 200.

### docs/config-upgrades.md
- Accurate. One stale string: `scripts/migrate-owner.ts` still says "people:
  block in trip.md".

### docs/ROADMAP.md
- **L4-5**: `docs/plans/INDEX.md` does not exist.
- **L15**: nothing cites §1.1.
- **L38, 52, 53**: decisions 9, 23 and 24 point to §2.1, §0.7 and §0.8,
  which don't exist.
- **Decision 5** ("hosted deferred") and **§12**: reversed; the hosted product
  exists.
- **Decision 21** ("ECB at build time"): now a deploy-time and nightly
  refresh.
- **Decision 24** ("no editing UI, ever"): reversed by the studio. Its
  amendments cite `PATCH /api/journal`, `/agent` and a plan file, all gone.
  About eight code comments still cite 24 for "there is no form":
  - `TripsIndexContent.tsx:361`
  - `MePageContent.tsx:148, 397`
  - `lib/tripWrite.ts:147`
  - `test/empty-journal.test.tsx:22`
  - `test/access-panel-empty.test.tsx:25`
  - `app/docs/helper/page.tsx:16-20`
- **Decision 25**: the `llms.txt` alias doesn't exist.
- **Decision 28**: says "POST …/days". There is no POST; it is
  `PUT …/days/{slug}`. Decisions 26 and 27 are out of order.
- **Decision numbers collide.** Code cites "decision 3/4/5/7" from the
  missing `docs/v2-migration/00-decisions.md`, and those numbers clash with
  ROADMAP's 3/4/5/7. Examples:
  - `lib/api/v2/write.ts:536`
  - `trips/[trip]/route.ts:109`
  - `lib/entries.ts:262`

  There are also ticket-local "decision N" citations (B338, B1495, B996).
- **Backlog items already built or partly built:**
  - E4 (Google Timeline): `importers/gps/google-*`
  - F3/F4 (track and zones)
  - B9 (analytics)
  - J7 (feed timezone)
  - L2/L5 (signup, delete and export)
  - G2/G3, partly
- **L237**: "nothing here is built" is wrong.
- **L252, 332**: "plain markdown" should be JSON.
- **L405**: journal `visibility: private` is legacy; the value is `guest`.
- **L398, §8–9**: postcards and photobooks are private-repo now.

### docs/guides (EN/DE/HU)
- ✔ **creator.md:4-7** (all three languages): "there is no editing screen,
  and there never will be". The studio exists. DE adds "weiterhin".
- **creator.md:11**: "markdown files". They are JSON.
- **creator.md:21**: "the dashed box". It is now a plain box ("Hand this to
  your agent").
- **creator.md:28-29**: the handover button moved from `/me` to
  `/<user>/studio/agent`.
- **creator.md:85**: "contacts page". It is now `/studio/readers`.
- **creator.md:90-92**: publishing does **not** send pushes; only
  `npm run notify` does. Push is also operator-only, not per journal.
- **creator.md:81-83**: emailed invites pre-approve, and invites expire after
  30 days. Neither is mentioned.
- **creator.md:95, guest.md:96**: WhatsApp and postcards are hosted-only, not
  flagged.
- **buddy.md:15-17**: "that trip and nothing else" is wrong. Approving a
  buddy-link joiner also grants journal-wide read of guest trips
  (`lib/contacts/index.ts:937-948`).
- **buddy.md**: omits the `/me` "Copy the instructions" button and the key
  list.
- **guest.md:111, 117**: `/me` shows "Edit my details" in place; it is not a
  link.
- **guest.md:131**: notifications can't be switched off per journal. "Not
  now" snoozes for 30 days. "Don't ask again" is instance-wide, which
  contradicts "per journal" at L53.
- **Translation drift:**
  - The `de/guest.md:88` caption quotes a button, "Erzähl mir von neuen
    Tagen", that doesn't exist; the DE string is "Bei neuen Tagen
    benachrichtigen". The `guide-notify-de.webp` image is probably stale
    too.
  - DE drops the sign-in screenshots without a note; HU shows the English
    ones with a note.
  - DE guide title "Für Tagebuch-Besitzer" is masculine only, while the body
    pairs both forms.
  - The HU captions quote English UI text although HU strings exist.

### docs/TESTING.md and docs/testing/**
- **TESTING.md:14-17**: `docs/qa/` doesn't exist.
- **L38**: "No configuration", but costs and reactions ship disabled and
  are operator-only.
- **B7**: "five days". There are 12 entries on 10 dates.
- **E6**: Mekong and Bangkok both have HU translations.
- **L128-134**: the journal-level `auth` flag is ignored (operator-only).
- **L158**: "no editing UI" (see decision 24).
- **G7**: a different email gives 403, not a silent 202.
- **G8**: says four trips. There are eight.
- **G12**: publish of a sparse draft is refused.
- **H2/H5**: `/contacts` is a redirect.
- **H6-H13**: `npm run digest` does not exist; day letters replaced digests.
- **I9**: `/welcome` is the signup page now.
- **I10**: the quoted German string exists in no locale.
- **L239**: "SMTP not implemented". `lib/mail/smtp.ts` exists.
- **L241**: "Nothing is deployed". fernscout.ch is.
- **Personas and flows quote AGENTS.md text that isn't there:**
  - `coverage.ts:4`
  - `buddy-*`, `guest-established`, `operator`, `owner-established` personas
  - about ten flows
- **They reference the retired `/agent` route:**
  - `buddy-established`
  - `owner-new`
  - `use-agent-helper`
  - `add-day-agent`
  - `onboard-whatsapp`
- **They reference `/api/auth/identity/request|verify`.** These are gone; the
  replacement is `/api/auth/codes {"for":"identity"}`.
- **They reference missing files:**
  - `scripts/simulate-webhook.ts`
  - `scripts/fixtures/webhooks/`
  - `test/credits.test.ts`
  - `get-token.sh`
  - `lib/whatsapp/onboarding.ts`
  - `.claude/skills/test-*`
  - `docs/plans/…`
  - `docs/superpowers/…`
- **Reactions and costs are called "shipped default on"**; both ship `false`.
- **Analytics coverage** points at the admin dashboard. The capability is
  the studio "Visitors" page.
- **Flow "Interface:" labels don't match `coverage.ts`.**
- **Hosted-only flows read as local tests**: photobook, credits, whatsapp,
  sms, fulfilment.

### Agent-facing text (`/documentation.txt`, `/skill/*.md`, `agentCopy.ts`)

Every item here breaks a real agent run.

- ✔ **add-a-day**: the example body would fail.
  - It omits the required `status` (`schemas/day.ts:193-211`), giving 422.
  - ✔ It uses a `lat` key that doesn't exist; the field is
    `coordinates:{lat,lng}`.
  - ✔ It refers to a `weatherData` field; the field is `weather`.
- **ingest-photos**: the example `day` is not a `YYYY-MM-DD-slug`, which gives
  404.
- **costs**: the `bank_export` example omits the required `format`, which
  gives 400.
- **costs**: says a date with no day is "refused". Such rows are filed to the
  trip (`filedToTrip`).
- **costs**: the over-limit error is `invalid_entry` or `invalid_trip` on PUT,
  not `invalid_request`.
- **new-account** and **documentation.txt**: never mention the phone proof
  (`/api/auth/signup/phone` and `/redeem`) that `POST /api/v2/journals`
  requires (`phone_required`).
- **new-account**: "`/api/auth/codes` always 202". A stranger with
  `for:"write"` gets 403.
- **add-a-trip**: says PATCH is "nothing is asked". In fact the whole trip is
  re-validated, and once there are photos `cover` becomes required.
- **add-a-trip**: says `days` can be left empty. It is declinable-required.
- **add-a-trip**: says `PUT /figures/{id}` is "create or replace". Replacing
  needs `If-Match`.
- **add-journal**: "`owner.email` is refused on every write". There is a
  verified change flow (`owner/email/redeem`), and OpenAPI documents it.
- **add-journal** vs **new-account**: they disagree on whether
  `locales[0]` is the default (see Part A 7).
- **invite-someone**: says "approve is the only call that grants". So do
  `contacts/grant` and emailed invites.
- **invite-someone**: says links "grant nothing by themselves". That
  contradicts its own line about email pre-approval.
- **make-a-photobook**: "there is no propose call". There is:
  `PUT /photobooks/drafts/{trip}`.
- **ingest-photos**: "Nothing here reads EXIF". Media items return
  `takenAt`, `lat` and `lon` with `measuredFrom: "exif"`.
- ✔ **documentation.txt:148**: "No call returns the owner's email".
  `GET /api/v2/{user}` does, and so do journal and trip DELETE (`mailedTo`).
- **documentation.txt:78**: "markdown". It is JSON.
- **documentation.txt:321**: "a non-public trip has no twin". Twins are gated
  like pages.
- **documentation.txt:183**: "nothing accepts a manual upload". The studio
  does.
- **documentation.txt:122**: "(see below)" about credits points at nothing.
- **documentation.txt:122**: says the messenger is a way in. WhatsApp is
  hosted-only.
- **`agentCopy.ts` `VISIBILITY_MEANING` / `VISIBILITY_NOT_A_LOCK`**: say a
  trip's visibility "follows the journal default". v2 requires it
  explicitly.
- **`agentCopy.ts` `SECOND_LANGUAGE_COMMITMENT`**: says "`POST …/days`
  answers 400". It is `PUT`, the answer is 422, and translations can be
  declined.
- **`agentCopy.ts` `buddyPrompt`**: its status call omits the
  `Authorization` header (the B1765 bug again). Its step 2 contradicts
  itself.
- **`markdownTwin.ts:150`**: says "days are listed at documentation.txt".
  Only trips are listed.
- **Paid features are mentioned in open-edition skills without saying so**:
  add-a-day (`sendWhatsapp`, `purchases/{id}`, 402), `reminder.channel:
  whatsapp`, and `status.pricing`.
- **Refusal wording is inconsistent**:
  - Operator-only capabilities are refused as "not switched on for this
    journal".
  - A trip token gets `forbidden` on most routes but `out_of_scope` on
    publish and send, and the `out_of_scope` text gives the wrong advice to
    a buddy.
  - `scope` is returned in three shapes.

### UI strings (`site/locales/*.json`)
- ✔ **`trips.emptyOwnerBody`** (all three languages): "there is no form, and
  there never will be". The studio trip form exists.
- **`agent.askRefuseRemove`**: points to a "Delete this trip" link that
  moved to the studio trip editor.
- **`contact.adminNoGuestTrip`**: refers to a pencil on "Your access" that
  was removed in B2018.
- **`agent.tool.inviteContact`**: says the invitee gets in once they
  confirm; the owner must still approve.
- **`studio.location.zones.lede`**: EN "Nothing inside it is ever shown,
  even to you … every trip's line" is false. The raw preview ignores zones,
  and zones apply to future lines (DE and HU say this correctly).
- **Speech consent**: "one credit per {minutes} started minutes" is wrong;
  billing is per second. `me.spentAiNote` "one credit per request" is also
  wrong.
- **`studio.photos.intro.whereExpires`**: "deleted within two days,
  automatically". There is no scheduled sweep; it runs lazily.
- **`studio.deleted.gone`**: "30 days" is a lazy purge.
  `del.tripWhatGoes` is stale.
- **`landing.step2Body`** and **`wa.onb.askEmail`**: "no other address can
  write". Buddies can.
- **`me.journalEmailNote`**: says the owner email "cannot be changed". The
  verified change flow exists.
- **`me.keysBody`**: "end when you revoke them, not on their own" vs "seven
  days" elsewhere. The iPhone GPS token lasts 30 days.
- ✔ **`landing.lede`** and **`landing.metaDescription`** (all three
  languages): "markdown and photographs" should be JSON.
- **`landing.pitchOwnBody`**: "Only paper costs money" appears on exactly the
  instances where the helper, voice and storage are also paid.
- **`landing.noTracking`**: "No analytics" sits beside opt-in visitor
  analytics.
- **"Guestbook" contradicts itself**: `me.askOwner` says "keeps no
  guestbook", while `contact.submit` says "Sign the guestbook".
- **Invented statistic**: "Most people are let in within a day or two" in
  `gate.waitingBody`, `invite.waitingBody` and `contact.mailRequestSoon`.
  There is no data behind it.
- **`trips.malformedUnparseable`**: says "frontmatter", but `trip.json` is
  JSON.
- **`phoneCodeSent`**: "30 minutes" is only true for dry-run and SMS; Twilio
  Verify codes last 10 minutes.
- **Hard-coded English**:
  - `WorldMap.tsx:651` ("Close")
  - `Charts.tsx:328`
  - `app/global-error.tsx`, whose inlined EN/DE/HU strings have drifted
- **Locale hygiene**:
  - DE mixes `ß` with Swiss `ss`, and `„…“` with `«…»`.
  - DE `docs.contributing.title` is still English.
  - The HU `fallback.writtenIn.hu` key is dead and says "English".
  - `hero.tagline`, `docs.backToSite` and `publish.visibilityPublic` look
    dead.

### site/legal (en and de)
- **L62**: mail copies are kept "two days". The sweep is lazy, and a
  directory nothing writes to again is never swept.
- **L55, 218**: tokens last "seven days". The iPhone GPS token lasts 30, and
  owner tokens can renew themselves indefinitely.
- **L226-228**: "deleting a trip sends a confirmation email". The studio
  deletes directly.
- **L60**: analytics kept "ninety days". Old rows are pruned only when the
  report is opened.
- **L171-176**: "nothing goes to Google until clicked". The planner resolves
  `maps.app.goo.gl` and `maps.apple.com` short links server-side, and those
  services are missing from the recipients table.
- **L229-231**: "every row deleted". Photo-import staging and mail copies
  survive journal deletion. The day trash and staging aren't described.
- **L64, 231**: "14 days" of backups is actually 14 daily *generations*.
- `lib/legal.ts:24` says the legal page is "absent by default", but a
  specific operator's legal text is committed and served by every clone.
- There is no `hu.md`; it falls back to EN with a notice.

---

## Part D — Inconsistent wording: decisions needed

Answer these once and the rewrite can apply them everywhere, in UI, skills,
docs and error texts. For each one there is a suggested answer.

1. **Is Fernscout "an agent writes your day" or "you write in your studio"?**
   README, BRAND.md and the landing page say the first; AGENTS.md says the
   second. The guides say there is no editor at all.
   *Suggest*: studio first, agent second, and retire decision 24's "no
   editing UI" formally.
2. **"helper" names four things.**
   - the built-in model capability (`features.helper`)
   - the hosted WhatsApp helper
   - the separate MIT tool "Fernscout Helper" (`fernscout-helper`)
   - the `/api/helper/**` cookie routes, many of which involve no model

   The UI also calls the built-in model "agent" (`agent.title` "Write with
   your agent"). *Suggest*:
   - "agent" is only an external client holding a token.
   - "helper" is only this instance's model.
   - Rename the external tool (e.g. "Fernscout Importer").
   - Treat `/api/helper` as a code name only.
3. **key or token?** The studio says "key" (Schlüssel/kulcs); mails, docs and
   skills say "token". The "handover credential" is also called a key or a
   code. *Suggest*: "key" for people, "token" in the API reference only.
4. **"guest" means five things**:
   - journal visibility (unlisted, *not* locked)
   - trip visibility (approved readers)
   - photo visibility
   - invite kind
   - `SessionKind "guest"` / `fs_session`, which also carries the owner

   Costs visibility spells it `"guests"`. The guide id is `guest`, its title
   is "For readers", and the studio page is "Readers". *Suggest*:
   - Journal visibility becomes `listed`/advertised.
   - "reader" is the person.
   - "guest" is only the trip or photo gate.
5. **owner / creator / author / traveller / "whoever keeps this journal".**
   The guide id is `creator` and its title is "For journal owners".
   "traveller" means the owner, the trip people, *and* the drawn figures
   (`/travellers`). *Suggest*: "owner"; rename the guide id; reserve
   "figures" for drawings.
6. **buddy / travel companion / people / party / "you travelled".**
   - The trip field is `people`.
   - The studio "People" page means people *named in* days.
   - "companion" also means someone recognised in photos, and the private
     repo.
   - DE uses "Mitreisende" and "Mitgereiste".

   *Suggest*: "buddy" in prose and "trip people" in the API, and rename the
   studio page "People in your days".
7. **day / entry / update / stop / story.**
   - v2 "day" is one document.
   - The internal `Day` is a calendar day of several `Entry`, shown as
     "updates".
   - "stop" means a plan stop, a story-rail day and a place cluster.
   - The "Story" tab is translated as "Reise" (DE, = trip) and "Napló" (HU,
     = journal).

   Pick one name per concept.
8. **publish / share / put on the site / go online / take down.** The studio
   says "Share a day"; the API, legal page and AGENTS.md say publish. "Share"
   already means access sharing.
9. **operator / admin / self-hoster / "whoever runs this server".** Prose
   says operator; code says admin (`FERNSCOUT_ADMIN_EMAIL`, `/admin`). The UI
   says "The Fernscout admin". The UI keys `contact.admin*` /
   `home.adminSection*` mean the *owner*. "WhatsApp's operator" is a third
   party.
10. **site vs instance vs journal.**
    - `site/config.json` is the instance.
    - "on the site" is a journal's public pages.
    - `site.displayCurrencies` and "the site's baseCurrency" in docs are
      journal config.
11. **Where the server config lives.**
    - `site/config.json`
    - `$DATA_DIR/config.json`
    - `FERNSCOUT_CONFIG`
    - `content/config.json`
    - "instance config"

    *Suggest*: "the server config (`FERNSCOUT_CONFIG`, default
    `site/config.json`)", said the same way every time.
12. **Content format: markdown or JSON?** It is JSON, but "markdown" survives
    in the landing page (three languages), `/documentation.txt`, the guides,
    architecture.md, helper.md, CONTRIBUTING.md, ROADMAP, the ingest CLI and
    94 "frontmatter" code comments.
13. **route** means the planned route, the public line, GPS recording ("Your
    route") and an HTTP route. The raw store is called "GPS history",
    "location history", "position store" and "fixes". *Suggest*: "GPS
    history" for raw data, "track" for the derived line, and "route" only for
    the plan.
14. **Open vs hosted naming.**
    - "open edition" / "open core"
    - "hosted edition" / "hosted tier" / "hosted product"
    - "private repository" / "companion repository" / "features repository"
    - `paid/`

    Credits are open, and only buying them is hosted. Say that consistently.
15. **Should open-edition strings speak as fernscout.ch?** Examples:
    - "Fernscout is free … costs us money"
    - "We read them to make Fernscout better"
    - DE "unserem Agenten" and HU "a miénkre"
    - `agent@fernscout.ch`
16. **cost / spend / price.** The same words cover trip expenses, credits
    charged for actions, and the instance's running costs.
17. **capability vs feature.** Docs say capability; the config keys, errors
    and `FEATURE_NAMES` say feature. There are also three different
    "operator only" notions:
    - a journal can't vote (`OPERATOR_ONLY_FEATURES`)
    - the code is paid-only
    - hosted-only
18. **Licensing wording.** "Licence" vs "License". Are brand drawings
    "outside" Apache-2.0 (README, BRAND.md) or "inside, narrowed" (TRADEMARK
    L25)? This needs a legal answer.
19. **DE locale choices.** Journal / Reisetagebuch / Tagebuch? `ß` or Swiss
    `ss`? Credits or Guthaben?
20. **Decision numbering.** Requalify the v2-migration decision citations
    ("v2 decision 7") or inline them, since their source is gone?
21. **Hosted-only testing flows** (photobook, credits, whatsapp, sms,
    fulfilment): move them to the private repo, or mark them hosted-only?
22. **Delete semantics.** Narrow the AGENTS.md rule to "journal and trip
    delete", or make the other DELETEs match it?

---

## Part E — Suggestions for the overhaul

- **Make the tests catch this next time.**
  - Extend `test/docs-links.test.ts` to check backtick paths in `docs/*.md`
    and to scan `components/`, `proxy.ts`, `instrumentation.ts` and
    `next.config.ts`.
  - Stop letting "absent harness dirs" pass silently.
  - Add `site/locales` to `test/depersonalised.test.ts`.
- **Generate what can be generated.**
  - The capability table in capabilities.md from `lib/capabilities.ts` and
    `OPERATOR_ONLY_FEATURES`.
  - The skill examples from the Zod schemas, validated in a test (the
    add-a-day example would have failed one).
  - The env var list from `process.env` reads.
- **Pin the glossary.** Put one short `docs/glossary.md` in place, with EN,
  DE and HU columns, once Part D is answered, and link it from AGENTS.md.
- **Retire or split docs.**
  - `TESTING.md` is mostly dead: rewrite it against the current studio, or
    delete it.
  - Move ROADMAP's backlog out of the file, and mark decision 24 superseded.
- **Say "hosted-only" in one consistent place.** Give each doc that
  mentions a paid feature a short marker ("hosted edition only; absent
  here").

---

## Decisions (answered 2026-09-25)

Answers to Part D, in order. These are the rules for the rewrite.

1. **Story**: studio first. You write in your studio; an agent (yours) or
   this instance's assistant is an optional second way. ROADMAP decision 24
   ("no editing UI") is formally superseded.
2. **Helper**: the separate MIT tool keeps the name **Fernscout Helper**. This
   instance's built-in model is the **assistant** (web and, hosted, WhatsApp).
   "agent" means only an external client holding a key. `/api/helper/**` is a
   code name only.
3. **Credential**: **key** in all UI, mails and guides. **token** only in the
   API reference and skills, for the bearer token. The 20-minute handover
   credential is the **handover code**.
4. **Guest**: **reader** is the person. "guest" is used only for the trip and
   photo gate. Journal visibility becomes listed/unlisted ("advertised"). The
   guide id becomes `reader`. Fix the costs `"guests"` spelling.
5. **Owner**: **owner** everywhere. The guide id `creator` becomes `owner`.
   "traveller" is retired as a synonym; drawings are always **figures**.
6. **Buddy**: **buddy** in all prose and UI. `people` stays the API field
   ("trip people"). The studio "People" page becomes "People in your days".
   DE uses only "Mitreisende".
7. **Day**: readers and writers see **day**. When one date has several, each
   is an **update** (DE and HU re-translated to match). "entry" is a
   storage and code word only.
8. **Publish**: **Publish / Take down** on every button, mail, doc and skill.
   "share" is reserved for giving access.
9. **Operator**: **operator** in all prose and UI ("the operator of this
   server"). Code keeps its admin names; docs say "the operator, set via
   `FERNSCOUT_ADMIN_EMAIL`". Rename the `contact.admin*` and
   `home.adminSection*` locale keys, which mean the owner.
10. **Site**: the installation is **this server** / **instance**, and
    per-journal settings are **journal**. Drop "site" from prose; the
    `site/` folder keeps its name.
11. **Config file**: always "the server config (`FERNSCOUT_CONFIG`, default
    `site/config.json`)" and "the journal config
    (`content/<user>/config.json`)".
12. **Format**: "JSON documents and photographs" everywhere. Fix the ingest
    CLI message and the stale "frontmatter" and "markdown" code comments too.
13. **GPS**: **GPS history** is the raw private data, including recording.
    **track** is the derived public line. **route** is used only for the
    planned route. Studio "Your route" becomes "Your GPS history".
14. **Editions**: **open edition** / **hosted edition** / **the private
    repository**. Label features "hosted edition only". Credits are open;
    buying credits is hosted.
15. **Voice**: open strings are instance-neutral. Use `{site}`, "the operator
    of this server", and config values for the contact email, SMS prefixes
    and hosting region. fernscout.ch-specific copy and legal text move to
    the private repository. Add `site/locales` to the depersonalised test.
16. **Money words**: "costs" / "spent" mean trip money only. Credits "use N
    credits" and have a "price". The operator side is "running costs".
17. **Features**: say **feature** (matching `features.*`). Label each one
    **server-wide** or **per journal**, and separately **hosted edition
    only**. Generate `capabilities.md` from code.
18. **Licensing**: brand assets are outside the Apache grant, under
    BRAND-LICENSE. Fix TRADEMARK L25 and every "see LICENSE" pointer. Use
    British "licence" in prose and `LICENSE` as the filename.
19. **German**: **Reisetagebuch** (short form "Tagebuch"), `ß`, and `„…“`
    quotes. "Credits" for credits; "Guthaben" only for the balance.
20. **Decisions**: replace v2-migration citations with a one-line inline
    reason. Give each ROADMAP decision a status (upheld, superseded or
    reversed); mark 24 and 5 superseded, naming what replaced them. Move
    the stale backlog out of ROADMAP.
21. **Hosted docs**: move the hosted-only testing flows, and the hosted-only
    sections of helper.md and similar, to the private repository. The open
    docs keep one-line "hosted edition only" markers.
22. **Deletes**: narrow the rule. Deleting a journal or trip through the API
    needs the emailed confirmation. Smaller items (draft days, photos,
    invites, …) delete directly. The studio trip delete keeps the
    ConfirmPanel. Fix AGENTS.md, the skills and the legal page to say
    exactly this.
