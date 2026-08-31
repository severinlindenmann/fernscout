# W25 — Rebrand to Fernscout

**Depends on:** W01 (the identity being replaced) · **Wave F**

## Goal

The project is called **Fernscout** and lives at **fernscout.ch**. Nothing in
the repo, the deployment, or the running server still says Reisepost — and the
server survives the rename with its database and its backup history intact.

## Why the name changed

`reisepost.ch`, `.com` and `.de` are all registered by other people, so the
old name was never available to actually ship under. Fernscout is: *fern*
(far) + *scout* — and it describes the product better than Reisepost did. The
app is no longer just mail arriving from far away; it is an agent that walks
ahead, keeps the record, and reports back. `fernscout.ch` is registered.

Identity work is already done and is **not** part of this package — the mark,
the lockups and the rules live in `docs/branding/` and `docs/branding/BRAND.md`.
This package is the rename.

## The two halves

The rename splits cleanly, and the second half is the dangerous one.

**Half A — text.** Strings in the repo. Reversible, testable, no state.

**Half B — deployment.** The unix user, the service names, the data
directory, the SQLite filename, the Postgres role, and the restic tag. These
name *things that exist on a server*. A `sed` across the repo silently
produces a config that points at a database nobody has created and a backup
lineage nobody has written. Half B is a migration, not a find-and-replace.

## Scope — Half A: the repo

- **Identity slots**: `app/icon.svg` ← `docs/branding/icon-waymark.svg`;
  `app/apple-icon.tsx` and `app/opengraph-image.tsx` ← the waymark geometry
  (both currently inline the envelope by hand — replace the paths, keep the
  `ImageResponse` scaffolding). `app/manifest.ts` needs no change: it already
  reads the name from config.
- **Config**: `content/config.json` → `site.name: "Fernscout"`,
  `site.url: "https://fernscout.ch"`.
- **Package**: `package.json` name → `fernscout`; regenerate `package-lock.json`
  (`npm install --package-lock-only`) so CI's lockfile check stays green.
- **Docs**: `README.md`, `CONTRIBUTING.md`, `TRADEMARK.md`, `docs/ROADMAP.md`,
  `docs/runbook.md` (42 references — the densest file), `docs/deploy-mail.md`,
  `docs/ingest.md`, `TODO.md`, `docs/plans/INDEX.md` (its title line), and the
  W01 plan, which should gain a line saying it was superseded here rather than
  being rewritten as though Reisepost never happened.
- **Agent-facing**: `app/agent.md`, `app/documentation.txt`.
- **Code**: `lib/db/index.ts` (`__reisepostDb` cache key), `lib/db/url.ts`
  (help text and `defaultSqliteFile()`), `lib/postcard/pdf.ts` (the printed
  postcard footer — this one is *visible to recipients*),
  `app/api/auth/request/route.ts` (the sender name in OTP mail).
- **Tests**: `test/landing.test.tsx`, `test/db-url.test.ts` (13 references),
  `test/db-selection.test.ts`, `test/agent-interface.test.ts`,
  `test/ingest-run.test.ts` and the rest of the suite assert the old name.
  They change in the same commit as the code, never after.
- **CI**: `.github/workflows/ci.yml`.
- **Retire the old assets**: delete `docs/branding/reisepost-logo.svg`,
  `alt-postmark.svg`, `alt-stamp.svg`. They are in git history if anyone wants
  them; keeping dead marks next to live ones is how the wrong one ships.

## Scope — Half B: the deployment

Decide first: **is there a live instance?** If the answer is no, Half B is
just editing the same strings as Half A and this section costs nothing. If yes,
each item below is a step with an order.

- `deploy/reisepost.service`, `-worker.service`, `-backup.service`,
  `-backup.timer` → rename the files *and* their contents. Old units must be
  `systemctl disable --now`'d before the new ones are enabled, or both run.
- **Unix user + paths**: `User=reisepost`, `/srv/reisepost`,
  `/var/lib/reisepost`, `/etc/reisepost/env`. These are invisible to users.
  Renaming them is optional and carries real risk; **recommendation: leave
  them.** A server whose data directory is spelled `reisepost` is untidy, not
  broken. If they are renamed, the env file moves first and the units point at
  the new path in the same reboot.
- **SQLite**: `defaultSqliteFile()` returns `$DATA_DIR/reisepost.db`. If this
  becomes `fernscout.db` with no migration, the app boots against an empty
  database and looks like total data loss. Either keep the filename, or `mv`
  the file as a deploy step and fall back to the old name for one release.
- **Postgres**: `POSTGRES_USER`, `POSTGRES_DB` and the `DATABASE_URL` in
  `.env.example` all say `reisepost`. Renaming a live role and database is
  `ALTER DATABASE … RENAME` plus a connection-string change, with downtime.
  Same recommendation: change the example, leave a running instance alone.
- **restic**: `scripts/backup.sh` writes `--tag reisepost` and prunes with
  `restic forget --tag reisepost`. Changing the tag **orphans every existing
  snapshot** — they stop matching the retention policy, so they are never
  pruned, and the new tag starts a fresh lineage with no history. If the tag
  changes, run `forget` against the old tag once, deliberately.
- `deploy/Caddyfile` and `CADDY_DOMAIN` → `fernscout.ch`. No redirect from the
  old domain is needed or possible: we never owned `reisepost.ch`.

## Out of scope

Site redesign. Palette, typography, layout and components stay exactly as they
are — `BRAND.md` re-ranks yellow as the brand colour but adds no token and
moves no pixel. Replacing Fredoka is noted there as a future question and is
not this package.

## Acceptance

- [ ] `grep -ril reisepost` over the repo returns nothing outside
      `docs/plans/W01-branding.md`, `W25` and git history
- [ ] Favicon re-rendered and checked at a true 16×16 (the method is in
      `BRAND.md` §2 — rasterise at 16, blow up nearest-neighbour, look at it)
- [ ] OG image renders at 1200×630 with the waymark and the new wordmark
- [ ] `npm test` green; `npm run build` green; CI lockfile check green
- [ ] `TRADEMARK.md` names Fernscout and the waymark device
- [ ] `content/config.json` points at `https://fernscout.ch`
- [ ] Half B decision recorded in the PR: live instance yes/no, and for each
      of SQLite filename / Postgres role / restic tag, renamed or deliberately
      left alone
- [ ] Old brand SVGs deleted, `docs/branding/` contains only Fernscout assets
