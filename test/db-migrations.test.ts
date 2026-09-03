import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  MIGRATIONS,
} from "@/lib/db/migrations";
import {
  TABLE_NAMES,
  migrateDown,
  migrateToLatest,
  type DatabaseHandle,
} from "@/lib/db";
import { Migrator } from "kysely/migration";
import { migrationProvider } from "@/lib/db/migrations";
import { createDatabase } from "@/lib/db";
import { dialectCases, dropEverything, freshDatabase, postgresConfigured } from "./support/dialects";

const migrationsDir = path.join(process.cwd(), "lib/db/migrations");

describe("migration sources", () => {
  test("use only types both dialects understand", () => {
    // The acceptance criterion from docs/plans/W06-data-layer.md, enforced
    // rather than remembered. `jsonb`, arrays and `serial` are Postgres-only;
    // `timestamptz` reads back as a Date on Postgres and a string on SQLite,
    // which is the same bug wearing a different hat.
    const forbidden = /\b(jsonb|serial|bigserial|timestamptz|timestamp with time zone|uuid|enum)\b/i;
    for (const file of fs.readdirSync(migrationsDir)) {
      if (!file.endsWith(".ts") || file === "index.ts" || file === "types.ts") continue;
      const source = fs.readFileSync(path.join(migrationsDir, file), "utf8");
      const offending = source
        .split("\n")
        .filter((line) => forbidden.test(line) && !line.trim().startsWith("*"));
      expect(offending, `${file} uses a non-portable type`).toEqual([]);
    }
  });

  test("are named so that lexical order is execution order", () => {
    const names = Object.keys(MIGRATIONS);
    expect(names).toEqual([...names].sort());
    for (const name of names) expect(name).toMatch(/^\d{3}-/);
  });
});

if (!postgresConfigured()) {
  // Not a failure: the suite must be green on a laptop with no Postgres.
  // Set POSTGRES_TEST_URL to a database this suite may wipe to include it.
  console.warn("[test] POSTGRES_TEST_URL is not set — the Postgres dialect is being skipped.");
}

/**
 * The one hazard in `007-journal-wide-grants`: the new unique index is
 * narrower than the old one, so two grants that differed only by `trip_id`
 * would collide on it. Nothing shipped could write such a pair — approval, the
 * only insert, always wrote `*` — but a hand-written row could, and a
 * migration that fails halfway is worse than either outcome. So it collapses
 * them first, keeping the one that grants the most.
 */
describe.each(dialectCases())("007 on $name, against rows 006 allowed", ({ target }) => {
  test("collapses two grants for one contact into the wider one", async () => {
    const handle = await createDatabase(target);
    try {
      await dropEverything(handle);
      const migrator = new Migrator({ db: handle.db, provider: migrationProvider });
      const before = await migrator.migrateTo("006-standing-link");
      expect(before.error).toBeUndefined();

      const now = "2026-08-01T08:00:00.000Z";
      await handle.db
        .insertInto("contacts")
        .values({
          id: "c-dup",
          owner_id: "ana",
          email: "oma@example.com",
          email_key: "oma@example.com",
          name: null,
          locale: null,
          status: "active",
          notes: null,
          created_at: now,
          updated_at: now,
        })
        .execute();

      const grant = (id: string, tripId: string, expiresAt: string | null) => ({
        id,
        owner_id: "ana",
        contact_id: "c-dup",
        trip_id: tripId,
        scope: "read",
        granted_at: now,
        granted_by: "ana",
        expires_at: expiresAt,
      });
      await handle.db
        .insertInto("access_grants")
        .values([
          grant("g-expiring", "asia-2023", "2026-09-01T00:00:00.000Z"),
          grant("g-forever", "algarve-2024", null),
        ])
        .execute();

      await migrateToLatest(handle);

      const rows = await handle.db.selectFrom("access_grants").selectAll().execute();
      expect(rows.map((r) => r.id)).toEqual(["g-forever"]);
      // The survivor is the one that expires last, because merging two grants
      // has to keep what either of them allowed.
      expect(rows[0].expires_at).toBeNull();

      await dropEverything(handle);
    } finally {
      await handle.destroy();
    }
  });
});

describe.each(dialectCases())("schema on $name", ({ target }) => {
  let handle: DatabaseHandle;

  beforeAll(async () => {
    handle = await freshDatabase(target);
  });

  afterAll(async () => {
    if (handle) {
      await dropEverything(handle);
      await handle.destroy();
    }
  });

  test("creates every table the schema declares", async () => {
    const tables = (await handle.db.introspection.getTables()).map((t) => t.name);
    for (const name of TABLE_NAMES) expect(tables).toContain(name);
  });

  test("gives every table an owner column (ROADMAP §0.5)", async () => {
    const tables = await handle.db.introspection.getTables();
    for (const name of TABLE_NAMES) {
      const table = tables.find((t) => t.name === name);
      expect(table, `${name} is missing`).toBeDefined();
      const owner = table!.columns.find((c) => c.name === "owner_id");
      expect(owner, `${name}.owner_id is missing`).toBeDefined();
      expect(owner!.isNullable, `${name}.owner_id must be NOT NULL`).toBe(false);
    }
  });

  test("running the migrations again changes nothing", async () => {
    const { results } = await migrateToLatest(handle);
    expect(results).toEqual([]);
  });

  test("rolls all the way down and back up", async () => {
    const down = await migrateDown(handle);
    expect(down.results?.every((r) => r.status === "Success")).toBe(true);
    const tablesAfterDown = (await handle.db.introspection.getTables()).map((t) => t.name);
    for (const name of TABLE_NAMES) expect(tablesAfterDown).not.toContain(name);

    const up = await migrateToLatest(handle);
    expect(up.results?.map((r) => r.migrationName)).toEqual(Object.keys(MIGRATIONS));
  });

  test("round-trips a row in every table as the same JavaScript values", async () => {
    const owner = "owner";
    const now = "2026-08-30T09:15:00.000Z";

    await handle.db
      .insertInto("users")
      .values({
        id: "u1",
        owner_id: owner,
        email: "someone@example.com",
        name: null,
        role: "owner",
        locale: "de",
        created_at: now,
        updated_at: now,
        last_login_at: null,
      })
      .execute();

    await handle.db
      .insertInto("sessions")
      .values({
        id: "s1",
        owner_id: owner,
        user_id: "u1",
        created_at: now,
        expires_at: now,
        kind: "guest",
        token_hash: null,
        scope: null,
        last_seen_at: null,
        revoked_at: null,
        user_agent: null,
        ip: null,
      })
      .execute();

    await handle.db
      .insertInto("contacts")
      .values({
        id: "c1",
        owner_id: owner,
        email: "reader@example.com",
        email_key: "reader@example.com",
        name: "A Reader",
        locale: null,
        status: "active",
        notes: null,
        created_at: now,
        updated_at: now,
      })
      .execute();

    await handle.db
      .insertInto("access_grants")
      .values({
        id: "g1",
        owner_id: owner,
        contact_id: "c1",
        scope: "read",
        granted_at: now,
        granted_by: "u1",
        expires_at: null,
      })
      .execute();

    await handle.db
      .insertInto("push_subscriptions")
      .values({
        id: "p1",
        owner_id: owner,
        contact_id: "c1",
        endpoint: "https://push.example/abc",
        p256dh: "key",
        auth: "auth",
        user_agent: null,
        created_at: now,
        last_seen_at: null,
      })
      .execute();

    await handle.db
      .insertInto("reactions")
      .values({
        id: "r1",
        owner_id: owner,
        trip_id: "trip",
        day_slug: "day",
        voter_id: "v1",
        emoji: "❤️",
        created_at: now,
        updated_at: now,
      })
      .execute();

    await handle.db
      .insertInto("jobs")
      .values({
        id: "j1",
        owner_id: owner,
        kind: "digest",
        payload: JSON.stringify({ to: ["reader@example.com"] }),
        status: "pending",
        attempts: 0,
        run_at: now,
        locked_at: null,
        locked_by: null,
        last_error: null,
        created_at: now,
        updated_at: now,
      })
      .execute();

    await handle.db
      .insertInto("tracking_points")
      .values({
        id: "t1",
        owner_id: owner,
        trip_id: "trip",
        device_id: "phone",
        recorded_at: now,
        lat: 47.3769,
        lon: 8.5417,
        altitude: 408.5,
        accuracy: null,
        speed: null,
        battery: 73,
        raw: JSON.stringify({ _type: "location" }),
        created_at: now,
      })
      .execute();

    await handle.db
      .insertInto("print_orders")
      .values({
        id: "o1",
        owner_id: owner,
        kind: "postcard",
        provider: "dry-run",
        provider_ref: null,
        contact_id: "c1",
        trip_id: "trip",
        status: "draft",
        payload: "{}",
        cost_minor: 250,
        currency: "CHF",
        created_at: now,
        updated_at: now,
      })
      .execute();

    // Timestamps come back as the strings that went in — not `Date` on one
    // dialect and `string` on the other. That equivalence is the entire
    // reason the schema stores them as text.
    const user = await handle.db
      .selectFrom("users")
      .selectAll()
      .where("id", "=", "u1")
      .executeTakeFirstOrThrow();
    expect(user.created_at).toBe(now);
    expect(user.name).toBeNull();

    const point = await handle.db
      .selectFrom("tracking_points")
      .selectAll()
      .where("id", "=", "t1")
      .executeTakeFirstOrThrow();
    expect(point.lat).toBeCloseTo(47.3769, 6);
    expect(point.lon).toBeCloseTo(8.5417, 6);
    expect(typeof point.lat).toBe("number");
    expect(point.battery).toBe(73);
    expect(JSON.parse(point.raw!)).toEqual({ _type: "location" });

    const job = await handle.db
      .selectFrom("jobs")
      .selectAll()
      .where("id", "=", "j1")
      .executeTakeFirstOrThrow();
    expect(job.attempts).toBe(0);
    expect(typeof job.attempts).toBe("number");
    expect(JSON.parse(job.payload)).toEqual({ to: ["reader@example.com"] });

    const order = await handle.db
      .selectFrom("print_orders")
      .selectAll()
      .where("id", "=", "o1")
      .executeTakeFirstOrThrow();
    expect(order.cost_minor).toBe(250);

    // Column defaults have to agree too — `defaultTo("pending")` is only
    // portable if both engines actually apply it.
    await handle.db
      .insertInto("jobs")
      .values({
        id: "j2",
        owner_id: owner,
        kind: "push",
        run_at: now,
        created_at: now,
        updated_at: now,
      })
      .execute();
    const defaulted = await handle.db
      .selectFrom("jobs")
      .selectAll()
      .where("id", "=", "j2")
      .executeTakeFirstOrThrow();
    expect(defaulted.status).toBe("pending");
    expect(defaulted.attempts).toBe(0);
    expect(defaulted.payload).toBe("{}");
  });

  /**
   * `007-journal-wide-grants`. A grant is one bit — this contact may read this
   * journal — so the column that said *which trip* is gone.
   *
   * `contact_invites.trip_id` went with it and has since come back
   * (`009-invite-links`), which is why that half of this assertion is now the
   * other way round. It is not the old column returning: 007 removed a
   * dimension that would have narrowed *reading* to one trip, which B41
   * settled the other way and which nothing ever wrote. What 009 added says
   * which trip a **buddy** link is a link to join — a different question, on
   * a table whose rows grant nothing either way. The one that must stay gone
   * is `access_grants.trip_id`, and that is asserted here as it always was.
   */
  test("a read grant still says nothing about which trip", async () => {
    const tables = await handle.db.introspection.getTables();
    const columns = (name: string) =>
      tables.find((t) => t.name === name)!.columns.map((c) => c.name);
    expect(columns("access_grants")).not.toContain("trip_id");
    // The rest of the row is untouched — this dropped a dimension, not a table.
    expect(columns("access_grants")).toEqual(
      expect.arrayContaining(["owner_id", "contact_id", "scope", "granted_at", "expires_at"]),
    );
    // And the invite table carries one again, for the other question.
    expect(columns("contact_invites")).toContain("trip_id");
  });

  test("007 narrows access_grants_unique to one read grant per contact", async () => {
    const now = "2026-08-30T09:15:00.000Z";
    const row = (id: string, scope: string) => ({
      id,
      owner_id: "u-unique",
      contact_id: "c-unique",
      scope,
      granted_at: now,
      granted_by: null,
      expires_at: null,
    });
    await handle.db
      .insertInto("contacts")
      .values({
        id: "c-unique",
        owner_id: "u-unique",
        email: "u@example.com",
        email_key: "u@example.com",
        name: null,
        locale: null,
        status: "active",
        notes: null,
        created_at: now,
        updated_at: now,
      })
      .execute();

    await handle.db.insertInto("access_grants").values(row("ag-1", "read")).execute();
    // A second `read` grant is now the same grant twice, and refused.
    await expect(
      handle.db.insertInto("access_grants").values(row("ag-2", "read")).execute(),
    ).rejects.toThrow();
    // A different scope is a different grant, and still allowed.
    await handle.db.insertInto("access_grants").values(row("ag-3", "costs")).execute();

    await handle.db.deleteFrom("access_grants").where("owner_id", "=", "u-unique").execute();
    await handle.db.deleteFrom("contacts").where("id", "=", "c-unique").execute();
  });

  test("enforces the unique indexes the repositories rely on", async () => {
    const now = "2026-08-30T09:15:00.000Z";
    const row = {
      id: "r-dup",
      owner_id: "owner",
      trip_id: "trip",
      day_slug: "day",
      voter_id: "v1",
      emoji: "🤩",
      created_at: now,
      updated_at: now,
    };
    await expect(handle.db.insertInto("reactions").values(row).execute()).rejects.toThrow();
  });
});
