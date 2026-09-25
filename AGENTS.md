<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Fernscout, for contributors and agents

Fernscout is a self-hostable travel journal. A person's content is JSON
documents and photographs in a folder they own. A day is composed on one
page in the owner's own studio, from the owner's words, facts measured from
their photographs and real lookups — nothing is composed for them. A person
with no agent of their own reaches the same content model through a guided
web/WhatsApp helper.

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

## GPS is the most sensitive data here

GPS history under `content/<user>/gps/` is never exposed, never copied into
content, and never read by a new route. The public map uses only a derived,
clipped `trips/<trip>/track.json`. Any function that reads the raw store
directly is a deliberate, narrow, documented exception, gated behind its own
feature flag and reachable only from the owner's own browser cookie — never
from a bearer token. See `docs/gps.md` before touching anything under
`lib/gps/`.

## Authority boundaries

Agent bearer tokens reach `/api/**`, never rendered owner pages. Owner pages
use browser cookies. An identity cookie proves an email address and grants
nothing by itself — use the established resolution functions rather than
making credentials interchangeable for convenience. A link never carries
access on its own, whether it came from an invite or anywhere else. A
postcard or photobook API call creates a proposal, not a paid print; a
delete API call creates a confirmation email and removes nothing. Report
those states exactly.

## Secrets and personal data

Secrets are environment-only and never enter `site/config.json`, source,
fixtures or logs. Nothing personal belongs in application code —
`test/depersonalised.test.ts` enforces this across the source directories.

## Closed by default, portable by construction

Every optional capability is off by default and must be absent, not broken,
when disabled; `lib/capabilities.ts` decides and `/api/health` explains. No
feature requires a paid provider account to develop or test — use this
repo's dry-run, simulated-provider and local-mail paths. Local development
is SQLite and production is Postgres; nothing outside `lib/db/` chooses the
dialect. Do not use `window.confirm`, `alert` or `prompt` — confirmations use
`components/ConfirmPanel.tsx` with an action-specific button.

## Verification

```bash
npm run verify
```

runs build, TypeScript, ESLint, Vitest and knip in the required order — the
gate before any merge. Run a single file while iterating with
`npx vitest run test/thing.test.ts`. A visible change is not verified by the
suite alone: check it in a real browser at desktop and phone width against
content that existed before your change, and check the console and request
log, not just a fixture authored for the change.

A new UI string needs real English, German and Hungarian entries in
`site/locales/`; run `npm run i18n:keys` after changing English. Translate it
yourself rather than leaving a key that falls back to English.

Anything under `app/api/` must keep its public contract truthful.
`/api/v2/**` contracts come from the Zod schemas in `lib/api/v2/schemas/`
and generate `/api/v2/openapi.json`; import enum constants from their
validator source rather than copying lists. Every accepted field must be
readable back, and limits must be discoverable before a caller hits them.

## Open edition and `paid/`

This repository is the complete, self-hostable open edition, licensed
Apache-2.0. A small set of hosted-only features (things that only make sense
run by one operator for many journals — printed photobooks and postcards, the WhatsApp helper, buying credits with Stripe)
live in a private companion repository and are never part of this codebase.
The app reaches them only through a `@paid/*` import alias; when the private
package is not present, the alias resolves to public stubs under
`lib/paid-stubs` that keep the app building and running with that feature
simply absent, per the closed-by-default rule above. Application code must
never import a `paid/` path directly — always through `@paid/*` — so a plain
clone of this repository, with nothing else installed, stays a complete,
working travel journal.
