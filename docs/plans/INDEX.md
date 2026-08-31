# Fernscout — implementation plan index

The roadmap (`docs/ROADMAP.md`) is *what and why*. This directory is *how*:
one file per work package, each independently executable in its own worktree.

**Status legend:** ⬜ not started · 🟨 in progress · ✅ merged to main

| # | Package | Depends on | Status |
| --- | --- | --- | --- |
| [W01](W01-branding.md) | Branding, identity, licence | — | ✅ |
| [W02](W02-config-capabilities.md) | Config file + capability registry | — | ✅ |
| [W03](W03-content-restructure.md) | Media into content/, de-personalise | W02 | ✅ |
| [W04](W04-i18n.md) | Two language layers + locale URLs | W02 | ⬜ |
| [W05](W05-currency.md) | Multi-currency + ECB rates | W02 | ✅ |
| [W06](W06-data-layer.md) | SQLite/Postgres data layer | W02 | ✅ |
| [W07](W07-mail.md) | Mail transport (file in dev, SMTP later) | W02, W06 | ✅ |
| [W08](W08-auth.md) | Email OTP auth, simulated in dev | W06, W07 | ✅ |
| [W09](W09-visibility.md) | Per-trip visibility + password (no DB) | W02 | ✅ |
| [W10](W10-contacts.md) | Contacts, invites, guest approval | W06, W07, W08 | ✅ |
| [W11](W11-digest.md) | Email digest + preferences | W07, W10 | ✅ |
| [W12](W12-push.md) | Push fan-out + install onboarding | W10 | ✅ |
| [W13](W13-postcards.md) | Postcard renderer + provider prep | W06, W10 | ✅ |
| [W14](W14-photobook.md) | Photobook layout + PDF/X + provider prep | W03 | ✅ |
| [W15](W15-ingest.md) | Photo/video ingest, EXIF, media interface | W02, W03 | ✅ |
| [W16](W16-ops.md) | Docker, Caddy, backups, health | W02 | ✅ |
| [W17](W17-quality.md) | Tests, a11y, performance | W02 | ✅ |
| [W18](W18-agentic.md) | Skills, AGENTS.md, REST API, MCP | W06 | 🟨 |
| [W19](W19-presentation.md) | Presentation mode, slideshow, export | — | ✅ |
| [W20](W20-tracking.md) | OwnTracks/Overland ingest, route render | W06 | ⬜ |
| [W21](W21-extras.md) | RSS, search, export, archive | W02 | ✅ |
| [W22](W22-multi-user.md) | **Multi-user by default** — `content/<user>/…` | W02, W03 | ✅ |
| [W23](W23-agent-interface.md) | **The agent is the editor** — `/documentation.txt`, `/agent.md`, two token classes | W02, W06, W22 | ✅ |
| [W24](W24-landing-page.md) | Landing page — what this is, how to point an agent at it | W22, W23 | ✅ |
| [W25](W25-rebrand-fernscout.md) | Rebrand to Fernscout + fernscout.ch | W01 | ⬜ |

## Execution waves

Parallelism is bounded by shared files, not by cleverness. Packages in the same
wave touch disjoint areas.

- **Wave A** (serial): W02 — the keystone; nearly everything imports it.
- **Wave A2** (serial): **W22** — restructures `content/`, the URL space and the
  config model. Lands after the packages already in flight merge, and before any
  further feature work, because everything built against the single-user layout
  has to be revisited.
- **Wave B** (parallel): W01, W06, W16
- **Wave C** (parallel): W03, W09, W17
- **Wave D** (parallel): W04, W05, W07, W15
- **Wave E** (parallel): W08, W19, W21
- **Wave F** (parallel): W10, W18, W20, W23, then W24 (it explains W23),
  then W25 (renames what W24 describes)
- **Wave G** (parallel): W11, W12, W13, W14

## Ground rules for every package

1. **Local dev uses SQLite; production uses Postgres.** No code outside the data
   layer may know which. See W06.
2. **No feature requires a paid account to develop or test.** Mail writes `.eml`
   files to `./mail/`. OTP codes are printed and written to the same place.
   Print providers get a `dry-run` backend that writes files.
3. **Every optional capability is off by default** and absent, not broken, when
   disabled (ROADMAP §1.1).
4. **Secrets never enter `content/config.json`** — environment only.
5. **Done means:** `npm run lint`, `npx tsc --noEmit` and `npm test` all pass,
   the dev server boots with the feature both **on and off**, and the package's
   own acceptance criteria are met.
6. **Nothing personal in code.** Grep for the travellers' names and the trip ids
   outside `content/` must return nothing (W03 enforces this with a test).
7. **Everything personal is user-scoped.** After W22, anything belonging to a
   person — trips, media, config, generated postcards, books and mail — lives
   under `content/<username>/`. Nothing user-owned is written anywhere else.

## Wave 4 — people, safety and the planning side (Aug 2026)

Requested after the QA run. Ordered by dependency: W26 and W29/W30 are
foundations, W27/W28/W31 build on them, W32 and W33 are independent.

| | | Depends on | State |
| --- | --- | --- | --- |
| [W26](W26-trip-people.md) | People on a trip, with edit rights | — | ✅ |
| [W27](W27-trip-visibility.md) | private / public / guest | W26 | ✅ |
| [W28](W28-agent-safety-gates.md) | Confirmation codes; money behind a human | W29 | ✅ gates done; the paid-order state machine is not |
| [W29](W29-content-validation.md) | Validate entries and media, and say what is wrong | — | ✅ |
| [W30](W30-media-upload.md) | Upload media; keep the originals | W29 | ✅ upload and originals done; WebP `<picture>` is not |
| [W31](W31-account-panel.md) | "What can I see?" for guests and travellers | W26, W27 | ✅ |
| [W32](W32-trip-end.md) | A trip that is over stops saying "right now" | — | ✅ |
| [W33](W33-plans-from-drafts.md) | Future drafts become planned stops | — | ✅ |
