# QA scenarios

The durable catalogue: **what** to test, **how**, and what counts as a pass.
`docs/TESTING.md` is the walkthrough a person follows by hand; this is the
version an agent can execute end to end, and it goes wider — API, MCP, auth,
mail, multi-user, and the parts of the product that only misbehave when two
journals share an instance.

Results of a run go in `docs/qa/RESULTS-<date>.md`, which is working output
rather than documentation: keep it while the findings are open, and delete it
once they are fixed. Nothing in the repository should depend on one being
there.

## The instance under test

Every scenario below assumes an instance built for it, not the repo's own
`content/`. That instance is the point: it has **two journals**, every optional
capability **on**, and no paid account anywhere.

```bash
QA=/tmp/fernscout-qa
rm -rf "$QA" && mkdir -p "$QA"
cp -R content "$QA/content"                 # example: 4 trips
# ... plus a second journal, "bea", one trip, German, EUR
node -e '...'                               # features.mail/auth/contacts = true

export CONTENT_DIR="$QA/content"
export DATABASE_URL="sqlite:$QA/qa.db"
export SESSION_SECRET=$(openssl rand -hex 32)
export CONTACTS_ENCRYPTION_KEY=$(openssl rand -hex 32)
export AUTH_DEV_CODE=123456                 # so no inbox is needed
npm run db:migrate && npm run build && PORT=3400 npm start
```

**No SMTP and no Postgres, on purpose.** That is the configuration a
self-hoster gets by default, and the one that has to work: mail is written as
`.eml` files under `content/<user>/mail/` for a person or an agent to pick up
and forward, and the database is a SQLite file. If a scenario below only
passes with a mail server or a Postgres URL, that is the finding.

Out of scope for this pass, by instruction: **photobook and postcard
generation** (a later feature). Their capability wiring is still checked.

## Legend

✅ pass · ❌ fail · ⚠️ works but wrong · ⏭️ skipped, with a reason

---

## A — Foundations

| # | Scenario | Pass |
| --- | --- | --- |
| A1 | `npx tsc --noEmit` | No output |
| A2 | `npx eslint .` | 0 errors |
| A3 | `npm test` | All green |
| A4 | `npm run build` | Compiles |
| A5 | Boot with every capability **off** | Server starts; optional features are *absent*, not broken |
| A6 | Boot with every capability **on** | Server starts; `/api/health` says every one is on |
| A7 | Boot with a capability on but its env var missing | Boot **fails**, naming the flag and the variable |
| A8 | `npm run db:migrate` against a fresh SQLite file | Tables created; `db:status` agrees |
| A9 | Repo hygiene: no personal data, no stray build output | `test/depersonalised.test.ts` passes and the tree is clean |

## B — Reading a journal (frontend)

Desktop **1440×900** and mobile **390×844**, both.

| # | Scenario | Pass |
| --- | --- | --- |
| B1 | Every public route returns 200 for both journals | No 404, no 500 |
| B2 | No page scrolls sideways at 390px | `scrollWidth <= innerWidth` |
| B3 | No console errors on any page | 0 errors |
| B4 | The header never overlaps itself, 390–1920px | Title box never overflows |
| B5 | Story pager walks every day of an 18-day trip | Every day renders; nothing sticks on "Fetching this day…" |
| B6 | Deep link `#day-<slug>` opens on that day | Correct day in view |
| B7 | Gallery, map, costs, search, trips index for both journals | Populated, no zeroes where there is content |
| B8 | Keyboard: tab through a page | Visible focus ring throughout |
| B9 | Images have dimensions and never stretch | No layout shift, correct aspect |
| B10 | 404s: unknown day, unknown trip, unknown user | The site's own not-found page |

## C — Content model

| # | Scenario | Pass |
| --- | --- | --- |
| C1 | A draft entry (`status: draft`) | Absent from story, feed, sitemap, search, gallery, API reads |
| C2 | Removing `status: draft` publishes it | Appears everywhere |
| C3 | Several entries on one date | Ordered by `time:`, grouped as one day |
| C4 | Media paths stay trip-relative | Owner prefixed at read time; no username in frontmatter |
| C5 | Trip statuses current / past / upcoming | Current at bare URLs, upcoming shows a countdown and no days |
| C6 | `plan.md` route stops | Drawn on the map, reached stops marked |

## D — Privacy and isolation

The section where a mistake is unrecoverable.

| # | Scenario | Pass |
| --- | --- | --- |
| D1 | `visibility: password` | Gate on the trip; the rest of the journal still readable |
| D2 | Wrong password | Refused with a usable message |
| D3 | Right password | Opens, and stays open across pages |
| D4 | A private trip's media by direct URL, no session | **404** |
| D5 | A private trip in `sitemap.xml` and `feed.xml` | Absent from both |
| D6 | `visibility: unlisted` | Reachable by link, absent from sitemap and switcher |
| D7 | `costsVisibility: guests` | Numbers hidden from a stranger |
| D8 | One journal's media URL under another user | 404 |
| D9 | Path traversal in `/[user]/media/...` | 404, never a file outside the journal |
| D10 | A reserved username (`api`, `admin`, …) | Never treated as a journal |
| D11 | An unrecognised `visibility:` value | Read as `password`, never as public |

## E — Money

| # | Scenario | Pass |
| --- | --- | --- |
| E1 | Per-trip frozen rates | Each trip converts at its own rate |
| E2 | Switching display currency | Every number changes, marked ≈ |
| E3 | The choice survives a reload | Server-side, not just local storage |
| E4 | Two journals with different base currencies | Each shows its own |
| E5 | No `NaN`, `undefined` or suspicious `0` anywhere | None |

## F — Languages

| # | Scenario | Pass |
| --- | --- | --- |
| F1 | `?lang=de` on a first load, private window | German immediately, no English flash |
| F2 | The choice persists without the parameter | Still German |
| F3 | `<html lang>` follows it | Correct attribute |
| F4 | Content translations vs UI chrome | Translated days in German; untranslated days fall back to source text with German chrome |
| F5 | A junk `?lang=` value | Ignored |
| F6 | Every maintained locale covers every English key | No key renders as its own name |
| F7 | Two journals with different default locales | Each honours its own |
| F8 | `sitemap.xml` hreflang | One entry per language |

## G — The agent interface

| # | Scenario | Pass |
| --- | --- | --- |
| G1 | `/documentation.txt` | Names the instance and its journals; `X-Robots-Tag: noindex` |
| G2 | `/<user>/documentation.txt` | That journal's own summary |
| G3 | `/agent.md` | Authenticate, read, write — with runnable examples |
| G4 | `/openapi.json` | Valid JSON, describes the v1 routes |
| G5 | `/<user>/day/<slug>.md` | Markdown **source**, not rendered HTML |
| G6 | `robots.txt` | Coherent with the noindex headers |
| G7 | Follow `/agent.md` literally, as a stranger would | Every documented call works as written |

## H — Authentication

| # | Scenario | Pass |
| --- | --- | --- |
| H1 | `POST /api/auth/request` for the owner address | 202, and an `.eml` appears in `content/<user>/mail/` |
| H2 | Same for a **non-owner** address | 202 (no enumeration) but **no** agent mail written |
| H3 | `POST /api/auth/verify` with the code | Token prefixed `fs_agent_` |
| H4 | Wrong code | Refused |
| H5 | An agent token in a cookie | Rejected — bearer only |
| H6 | A guest cookie used as a bearer token | Rejected |
| H7 | Guest session lifetime vs agent token lifetime | 365 days vs ~7 days |
| H8 | `POST /api/auth/logout` | Session gone |

## I — REST API v1

| # | Scenario | Pass |
| --- | --- | --- |
| I1 | `GET /api/v1/<user>/trips`, authorised | Every trip as JSON |
| I2 | Same, unauthorised | 401 |
| I3 | One user's token against another user's journal | 403/404, never data |
| I4 | `GET .../trips/<trip>/days` | Day summaries |
| I5 | `POST` a new day | 201, and the file says `status: draft` |
| I6 | That day on the site | **Absent** until a person publishes it |
| I7 | `GET /api/v1/<user>/drafts` | The draft, waiting |
| I8 | Re-POST the same title and date | 409 — a retry never overwrites |
| I9 | Malformed body, missing fields, bad dates | 400 with a usable message, never a 500 |
| I10 | No parameter anywhere skips draft status | Confirmed by reading the code and by trying |

## J — MCP

| # | Scenario | Pass |
| --- | --- | --- |
| J1 | `initialize` over Streamable HTTP | Protocol version and capabilities |
| J2 | `tools/list` | The documented tools |
| J3 | `tools/call` a read tool | Real content |
| J4 | `tools/call` a write tool | A draft, same as REST |
| J5 | Unauthenticated call | 401 with `WWW-Authenticate` |
| J6 | `/api/well-known/oauth-protected-resource` | RFC 9728 metadata |
| J7 | Cross-user access with a valid token | Refused |

## K — Mail with no mail server

The open-source promise: everything works, the mail lands in a folder.

| # | Scenario | Pass |
| --- | --- | --- |
| K1 | Every mail the app sends, with `transport: file` | `.eml` under `content/<user>/mail/`, one file per message |
| K2 | Open one in a mail client | Valid MIME, readable, links absolute |
| K3 | An invite link the owner issued, `/<user>/i/<token>` | A form: name, email, optional postal address. `/<user>/join` redirects to `/<user>/me` and offers nothing (B37) |
| K4 | Submitting it | Confirmation code by `.eml`; entering it confirms |
| K5 | The owner's notification | "Somebody wants to follow" mail written |
| K6 | `/<user>/contacts` as owner | The pending request, with approve |
| K7 | `npm run digest -- --user <u> --dry-run` | Lists recipients, sends nothing |
| K8 | `npm run digest -- --user <u>` | One `.eml` per approved contact |
| K9 | Digest twice in a row | The second sends nothing |
| K10 | A contact whose language is German | Their mail is German |
| K11 | Unsubscribe link in a digest | Works without a login |
| K12 | Postal addresses at rest | Encrypted; not readable in the database file |

## L — Multi-user without Postgres or SMTP

| # | Scenario | Pass |
| --- | --- | --- |
| L1 | Two journals on one instance | Both readable, neither leaks into the other |
| L2 | Each with its own title, locale, currency, owner | Honoured independently |
| L3 | Invite a reader to journal A | Works; journal B unaffected |
| L4 | Reactions on both journals | Counted per journal, never shared |
| L5 | Push subscriptions | Stored per journal |
| L6 | Owner of A cannot administer B | Refused |
| L7 | Deleting one journal's folder | The other still works |
| L8 | The whole of K and I against the **second** journal | Identical behaviour |

## M — Data layer

| # | Scenario | Pass |
| --- | --- | --- |
| M1 | Fresh SQLite: migrate, status | Consistent |
| M2 | Reactions survive a restart | Persisted |
| M3 | Nothing outside `lib/db/` knows the engine | Grep confirms |
| M4 | Running with no `DATABASE_URL` | Features needing a DB are off, the site still reads |

## N — Operations

| # | Scenario | Pass |
| --- | --- | --- |
| N1 | `/api/health` | Every capability with on/off **and why** |
| N2 | `/<user>/export.zip` and `npm run export` | A zip that could rebuild the journal |
| N3 | `npm run ingest` on a folder of photos | Dated, geotagged entries; **no GPS** in the resized files |
| N4 | `feed.xml`, `sitemap.xml`, `robots.txt`, `manifest.webmanifest` | Valid |
| N5 | The service worker | Absent in dev, present in a production build |
| N6 | `/offline` | Renders standalone |
| N7 | A story fetch that fails | Placeholder says which day, then recovers |

## O — Documentation and skills

Read as a stranger who has just cloned the repo.

| # | Scenario | Pass |
| --- | --- | --- |
| O1 | `README.md` | Explains what it is and gets you running; every command works |
| O2 | `AGENTS.md` | Accurate about the content model and the one rule |
| O3 | `CONTRIBUTING.md`, `LICENSE`, `TRADEMARK.md` | Present and coherent |
| O4 | `docs/ROADMAP.md` | Decisions match the code |
| O5 | `docs/TESTING.md` | Every numbered step is still true |
| O6 | `docs/runbook.md`, `docs/deploy-mail.md`, `docs/ingest.md` | Match reality |
| O7 | Each `.claude/skills/*/SKILL.md` | Followable start to finish; paths and commands exist |
| O8 | Every path, filename and command named in the docs | Exists |
