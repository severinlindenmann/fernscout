# Fernscout — implementation plan index

The roadmap (`docs/ROADMAP.md`) is *what and why*. This directory is *how*:
one file per work package, each independently executable in its own worktree.

**These are the plans as they were written, before the work.** They are kept as
the record of intent and are not updated to match what shipped, so a command or
a path in one of them may not be the form that exists today — W15 proposes
`npm run ingest -- <folder>` where the script takes `--user` and `--trip`, and
W13 proposes `--text` where the flag is `--message`. For what a command actually
takes now, read `README.md`, the skill, or `--help`.

**Status legend:** ⬜ not started · 🟨 in progress · ✅ merged to main

| # | Package | Depends on | Status |
| --- | --- | --- | --- |
| [W01](W01-branding.md) | Branding, identity, licence | — | ✅ |
| [W02](W02-config-capabilities.md) | Config file + capability registry | — | ✅ |
| [W03](W03-content-restructure.md) | Media into content/, de-personalise | W02 | ✅ |
| [W04](W04-i18n.md) | Two language layers + locale URLs | W02 | ✅ ¹ |
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
| [W18](W18-agentic.md) | Skills, AGENTS.md, REST API, MCP | W06 | ✅ |
| [W19](W19-presentation.md) | Presentation mode, slideshow, export | — | ✅ |
| [W20](W20-tracking.md) | OwnTracks/Overland ingest, route render | W06 | ⬜ |
| [W21](W21-extras.md) | RSS, search, export, archive | W02 | ✅ |
| [W22](W22-multi-user.md) | **Multi-user by default** — `content/<user>/…` | W02, W03 | ✅ |
| [W23](W23-agent-interface.md) | **The agent is the editor** — `/documentation.txt`, `/agent.md`, two token classes | W02, W06, W22 | ✅ |
| [W24](W24-landing-page.md) | Landing page — what this is, how to point an agent at it | W22, W23 | ✅ |
| [W25](W25-rebrand-fernscout.md) | Rebrand to Fernscout + fernscout.ch | W01 | ✅ |

## Ground rules

Every package was built under the rules in [`AGENTS.md`](../../AGENTS.md) —
SQLite locally and Postgres in production with nothing outside `lib/db/` knowing
which, no feature needing a paid account to develop, every optional capability
off by default and absent rather than broken, secrets in the environment only,
and nothing personal outside `content/`. They are not restated here; a rule kept
in two files disagrees with itself within a month.

**Done** additionally meant: `npx tsc --noEmit`, `npx eslint .`, `npm test` and
`npm run build` all pass, the dev server boots with the feature both on and off,
and the package's own acceptance criteria are met.

The original execution waves — which packages could run in parallel without
touching the same files — are dropped now that every one of them has merged.

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
| [W36](W36-blackbox-fixes.md) | Everything the three QA runs found | W26–W33 | ✅ |
| [W37](W37-owner-and-guests.md) | One owner, per-trip travellers, an editable guest list | W10, W26 | ⬜ |

There is no W34 or W35 — the numbers were skipped, not lost.

¹ **W04 shipped, but not the design in its file.** Locale URLs were built as a
shareable `?lang=` parameter plus a `fs.locale` cookie (`proxy.ts`) and
`hreflang` from `app/sitemap.ts`, rather than the `/[locale]/…` path segment the
plan proposed. Its unticked acceptance boxes describe the rejected design and
are kept as written; see ROADMAP M7.
