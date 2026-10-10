<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Fernscout, for contributors and agents

Fernscout is a self-hostable travel journal. A person's content is JSON
documents and photographs in a folder they own. **You write in your own
studio** — a day is composed on one page from your words, facts measured
from your photographs and real lookups. An agent (yours, holding a key) or
this instance's built-in **assistant** is an optional second way in, and
either can hand back written prose for you to review before it is kept —
nothing is composed without your review.

## Tell the truth about content and actions

Write only what the person or a real source supplied. Never invent weather,
places, meals, feelings, measurements, people or memories. An empty field is
better than plausible fiction.

New days are drafts. Publishing is a separate owner-only call, and it
requires the person's explicit consent in words. Never say an action
succeeded because it was proposed, queued or attempted: report what the code
actually did. `test: true` is the only exception for invented content, and a
whole test journal is named `test-<something>` so the label survives
exports and backups.

Only `"status": "published"` puts a day on the site; a day with any other
status, or none, reads as a draft (`dayFromJson` in
`lib/api/v2/documents.ts`).

## GPS is the most sensitive data here

GPS history under `content/<user>/gps/` is never exposed, never copied into
content, and never read by a new route. The public map uses only a derived,
clipped `trips/<trip>/track.json`, never inside the last 24h. A second
derived file, `track-recent.json`, carries only that last 24h and is keyed
on the trip's own visibility: never for anyone but the journal's real owner
on a `public` trip, `guestsLive` (default live) on a `guest` trip, the
travellers on a `private` trip — the instance operator gets none of it on a
journal that is not their own, whatever the trip says. Excluded from the
sync manifest and every export; see `docs/gps.md`'s "The live tail" for the
whole rule. `routeRecording` is the one flag that gates the recorder UI and
two doors, both on the owner's own cookie: a place name for a new day, and
the owner's own route page (the line, per-trip counts and km by mode) —
neither ever returns raw positions to a bearer token or a third party.
Several other doors read the raw store directly and are **not**
behind that flag or a cookie-only gate: `POST /api/v2/{user}/import` and
`POST …/trips/{trip}/track` (owner cookie or a `write:gps` bearer token),
and `GET /api/v2/{user}/gps` and `…/gps/zones` (owner cookie). See
`docs/gps.md` before touching anything under `lib/gps/`.

## Authority boundaries

Agent bearer tokens reach `/api/**`, never rendered owner pages. Owner pages
use browser cookies. An identity cookie proves an email address and grants
nothing by itself — use the established resolution functions rather than
making credentials interchangeable for convenience. A buddy link on its
own grants nothing, and an invite created with an email address
pre-approves that address before anyone clicks anything. A reader link
(`/j/<code>`, kind guest) is the invitation itself: whoever proves an email
through it is let in at once (B-2940), and the owner can block them or stop
the link. A trip link
(`/t/<code>`, kind read) is the exception to "a link on its own grants
nothing": whoever holds it reads that one guest trip's published days at
public reader level after one press, with no account, the owner can stop it,
and keeping it under an email only files a pending person. A
postcard or photobook API call creates a proposal, not a paid print. Deleting
a journal or a trip creates a confirmation email and removes nothing until
it is clicked; smaller deletes (a draft day, a photo, an invite, a contact)
remove immediately. Report those states exactly.

## Secrets and personal data

Secrets are environment-only and never enter `site/config.json`, source,
fixtures or logs. Nothing personal belongs in application code —
`test/depersonalised.test.ts` enforces this across the source directories.

## Closed by default, portable by construction

Every optional capability is off by default and must be absent, not broken,
when disabled; `lib/capabilities.ts` decides and `/api/health` explains.
`signup` is the one exception with no switch of its own — it is on wherever
a database and `SESSION_SECRET` exist, and `inviteOnly` (on by default) is
its real gate. No capability needs a paid provider account to develop or
test — each has a dry-run, simulated-provider or local-mail path — except
`helper` (and `extract`, which needs `helper`), which needs a real
`ANTHROPIC_API_KEY` and has no dry-run backend. Local development is SQLite
and production is Postgres; nothing outside `lib/db/` chooses the dialect.
Do not use `window.confirm`, `alert` or `prompt` — confirmations use
`components/ConfirmPanel.tsx` with an action-specific button.

The open edition's own written-for-you path is the `helper` capability
(polish text, describe photos, undo) in the studio. The web helper room
(`/agent`) is retired; WhatsApp is hosted-only.

## Verification

```bash
npm run verify
```

runs build, TypeScript, ESLint, Vitest and knip in the required order — the
gate before any merge. A caller with no terminal (an agent's own tool call)
must set `VERIFY_WILL_WAIT=1` in the same call, or it refuses to run
unattended. Run a single file while iterating with
`npx vitest run test/thing.test.ts`. A visible change is not verified by the
suite alone: check it in a real browser at desktop and phone width against
content that existed before your change, and check the console and request
log, not just a fixture authored for the change.

`main` is protected: every change arrives as a pull request, and it merges
only once the `ci-ok` check is green (it waits for every CI job). Open one
with `gh pr create --fill` and let it land with `gh pr merge --auto --merge`.

A new UI string needs a real entry in `site/locales/` for every locale in
`MAINTAINED_LOCALES` (`lib/i18n.ts`) — English, German, Hungarian, French and
Italian today; run `npm run i18n:keys` after changing English. Translate it
yourself rather than leaving a key that falls back to English.

Anything under `app/api/` must keep its public contract truthful.
`/api/v2/**` contracts come from the Zod schemas in `lib/api/v2/schemas/`
and generate `/api/v2/openapi.json`; import enum constants from their
validator source rather than copying lists. Every accepted field must be
readable back, and limits must be discoverable before a caller hits them.

## Open edition and `paid/`

This repository is the complete, self-hostable open edition, licensed
Apache-2.0. A small set of hosted-only features (things that only make sense
run by one operator for many journals — printed photobooks and postcards, the WhatsApp helper, plans billed through Stripe)
live in a private companion repository and are never part of this codebase.
The app reaches them only through a `@paid/*` import alias; when the private
package is not present, the alias resolves to public stubs under
`lib/paid-stubs` that keep the app building and running with that feature
simply absent, per the closed-by-default rule above. Application code must
never import a `paid/` path directly — always through `@paid/*` — so a plain
clone of this repository, with nothing else installed, stays a complete,
working travel journal.

The open repository still carries a handful of intentional shims for that private repository: `package.json` keeps scripts that
run `scripts/paid.mts` and print "not included" with exit 0 when `paid/` is
absent; `stripe` is a runtime dependency of the open package; and
`vitest.config.mts` includes `paid/test/**`, which is simply empty in a plain
clone.
