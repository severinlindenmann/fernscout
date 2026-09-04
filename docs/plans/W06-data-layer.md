# W06 — Data layer: SQLite in dev, Postgres in production

**Roadmap:** B2, B2a, B3, §0.5 · **Depends on:** W02 · **Wave B**

## Goal
One schema, two dialects, zero app code that knows which. Local development
needs no database server at all.

## Decision: Kysely, not Drizzle

> **This revises B2a in the roadmap.** Drizzle was chosen before the
> SQLite-in-dev / Postgres-in-prod requirement existed. Drizzle needs *separate
> schema definitions* per dialect (`sqlite-core` vs `pg-core`), which means
> maintaining the schema twice. Kysely has one typed schema and swappable
> dialects, which is exactly this requirement. Migrations run through Kysely's
> migrator on both.

- Dev: `better-sqlite3`, file at `$DATA_DIR/fernscout.db`
- Prod: `pg`, connection string from env
- Chosen by `DATABASE_URL` — `sqlite:./…` or `postgres://…`

## Schema (initial)
Every table gets an **owner column from the first migration** (§0.5), even
though there is one user today.

```
users, sessions, contacts, access_grants, push_subscriptions,
reactions, jobs, tracking_points, print_orders
```

Use portable types only: no `jsonb`, no arrays, no `serial` — text/integer/
timestamps that both dialects agree on. Store JSON as text.

## Also here
- **Migrate `.data/*.json` → DB** (B3): reactions and push subscriptions, with a
  one-shot importer so existing data survives. Removes the pm2 fork-mode
  constraint and the per-process write queue in `lib/store.ts`.
- Keep a **file-store fallback** so the no-DB prototype (ROADMAP §2.2) still has
  reactions. The repository layer picks file or DB based on capability.

## Acceptance
- [x] `npm run dev` works with **no database server installed**
- [x] The same migration suite runs clean on SQLite and Postgres
- [x] **The full test suite passes against both dialects** (CI matrix)
- [x] Existing `.data/reactions.json` imports without loss
- [x] With `db` unavailable and DB-requiring features off, the app still boots

### Running the Postgres half

SQLite runs with no setup. The Postgres cases appear when `POSTGRES_TEST_URL`
points at a database the suite may **wipe**, and are skipped — not failed —
when it doesn't, so a laptop with no Postgres still gets a green run.

```bash
POSTGRES_TEST_URL=postgres://postgres@127.0.0.1:5432/fernscout_test npx vitest run
```

A CI matrix is two entries: one plain run, one with that variable set.
