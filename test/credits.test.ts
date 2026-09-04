import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { auditOwner, balanceOf, grant, ledgerFor, refund, spend } from "@/lib/credits";
import { dialectCases } from "./support/dialects";

/**
 * B366's two security properties, mechanised.
 *
 * ## Read this before trusting the concurrency test
 *
 * It runs on every dialect `dialectCases()` offers, and it only *proves* what
 * it claims on Postgres. `better-sqlite3` hands Kysely a single connection, so
 * transactions there are serialised by the driver and a `spend` written as a
 * `SELECT` followed by an `UPDATE` — the exact bug the conditional statement
 * exists to prevent — passes the SQLite leg every time. That was verified by
 * mutation while this was written, not assumed: the naive implementation was
 * substituted in and all thirteen tests still passed.
 *
 * So on SQLite this is an accounting test, and on Postgres — where `pg` gives
 * out ten pooled connections and the interleave is real — it is the guard.
 * CI runs both legs (`.github/workflows/ci.yml` starts a Postgres service
 * container), which is where the property is actually held. On a laptop:
 *
 * ```
 * see POSTGRES_HOWTO in test/support/dialects.ts
 * ```
 *
 * The honest summary: do not read a green local run as proof that the race is
 * closed. Read the green *CI* run that way.
 */

let dir: string;

async function setup(dialect: string, creditsEnabled: boolean): Promise<void> {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-credits-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL =
    dialect === "postgres"
      ? process.env.POSTGRES_TEST_URL!
      : `sqlite:${path.join(dir, "credits.db")}`;

  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "R", url: "https://example.test" },
      users: { reserved: [] },
      features: { credits: { enabled: creditsEnabled } },
    }),
  );
  fs.mkdirSync(path.join(dir, "alice"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "alice", "config.json"),
    JSON.stringify({
      title: "Alice",
      owner: { name: "Alice A", nickname: "Alice", email: "a@example.test" },
    }),
  );
  clearConfigCache();
  clearUserCache();

  const handle = await getDatabase();
  // Postgres test databases are reused between runs, so a leftover row from a
  // previous file would read as a balance this test never granted.
  const { dropEverything } = await import("./support/dialects");
  if (dialect === "postgres") {
    await dropEverything(handle);
    const { migrateToLatest } = await import("@/lib/db/migrate");
    await migrateToLatest(handle);
  }
}

afterEach(async () => {
  await closeDatabase();
  delete process.env.CONTENT_DIR;
  delete process.env.DATABASE_URL;
  clearConfigCache();
  clearUserCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe.each(dialectCases().map((c) => c.name))("with credits switched on (%s)", (dialect) => {
  beforeEach(() => setup(dialect, true));

  test("a journal nobody has granted has nothing, and can spend nothing", async () => {
    expect(await balanceOf("alice")).toBe(0);
    expect(await spend("alice", 1, "day_mail", "alice/t/d")).toBe(false);
    // Refusing must not have conjured a row into existence.
    expect(await balanceOf("alice")).toBe(0);
    expect(await ledgerFor("alice")).toHaveLength(0);
  });

  test("spending exactly the balance succeeds; one more does not", async () => {
    await grant("alice", 10, "invoice 1");
    expect(await spend("alice", 10, "day_mail", "alice/t/d")).toBe(true);
    expect(await balanceOf("alice")).toBe(0);
    expect(await spend("alice", 1, "day_mail", "alice/t/e")).toBe(false);
    expect(await balanceOf("alice")).toBe(0);
  });

  test("a spend larger than the balance takes nothing at all — all or nothing", async () => {
    await grant("alice", 10);
    expect(await spend("alice", 25, "day_mail", "alice/t/d")).toBe(false);
    // Not 0, and not -15. The whole send is refused, the credits stay put.
    expect(await balanceOf("alice")).toBe(10);
  });

  test("ten concurrent spends of 2 against a balance of 10: exactly five win", async () => {
    // On Postgres this is the race. On SQLite the driver serialises it and
    // this only checks the arithmetic — see the note at the top of the file.
    await grant("alice", 10);
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => spend("alice", 2, "day_mail", `alice/t/d${i}`)),
    );
    expect(results.filter(Boolean)).toHaveLength(5);
    expect(results.filter((r) => !r)).toHaveLength(5);
    expect(await balanceOf("alice")).toBe(0);
    // Five ledger rows for the five that won, plus the grant. A losing spend
    // writes nothing.
    expect(await ledgerFor("alice")).toHaveLength(6);
  });

  test("a refund gives back only what it is asked for, and is recorded", async () => {
    await grant("alice", 10);
    await spend("alice", 8, "day_mail", "alice/t/d");
    await refund("alice", 3, "alice/t/d");
    expect(await balanceOf("alice")).toBe(5);
    const rows = await ledgerFor("alice");
    expect(rows.map((r) => r.delta).sort((a, b) => a - b)).toEqual([-8, 3, 10]);
    expect(rows.find((r) => r.delta === 3)?.reason).toBe("refund");
  });

  test("the ledger always sums to the balance", async () => {
    await grant("alice", 100);
    await spend("alice", 30, "day_mail", "alice/t/a");
    await spend("alice", 500, "day_mail", "alice/t/b"); // refused, writes nothing
    await refund("alice", 4, "alice/t/a");
    await spend("alice", 12, "day_whatsapp", "alice/t/c");
    await grant("alice", 7, "invoice 2");

    const audit = await auditOwner("alice");
    expect(audit.balance).toBe(100 - 30 + 4 - 12 + 7);
    expect(audit.ledger).toBe(audit.balance);
    expect(audit.ok).toBe(true);
  });

  test("a send with no recipients costs nothing and is not refused", async () => {
    expect(await spend("alice", 0, "day_mail", "alice/t/d")).toBe(true);
    expect(await ledgerFor("alice")).toHaveLength(0);
  });

  test("one journal cannot spend another's credits", async () => {
    await grant("alice", 10);
    expect(await spend("bob", 1, "day_mail", "bob/t/d")).toBe(false);
    expect(await balanceOf("alice")).toBe(10);
  });

  test("a fractional spend is a programming error, not a rounding decision", async () => {
    await grant("alice", 10);
    await expect(spend("alice", 1.5, "day_mail", "alice/t/d")).rejects.toThrow(/fractional/);
  });

  test("a grant must be a positive whole number", async () => {
    await expect(grant("alice", 0)).rejects.toThrow(/positive/);
    await expect(grant("alice", -5)).rejects.toThrow(/positive/);
    await expect(grant("alice", 2.5)).rejects.toThrow(/positive/);
  });
});

describe("with credits switched off", () => {
  beforeEach(() => setup("sqlite", false));

  test("every send is free, and nothing is recorded", async () => {
    expect(await spend("alice", 9999, "day_mail", "alice/t/d")).toBe(true);
    expect(await ledgerFor("alice")).toHaveLength(0);
  });

  test("there is no balance to show, which is not the same as zero", async () => {
    expect(await balanceOf("alice")).toBeNull();
  });
});

describe("the grant path is not reachable over HTTP", () => {
  beforeEach(() => setup("sqlite", true));

  /**
   * B366's property 1, mechanised rather than trusted. A credit card is
   * downstream of this number: a grant an HTTP request can reach is a card an
   * HTTP request can spend. B368 adds a "buy credits" button that mails
   * information and grants nothing — this is the test that keeps it honest.
   */
  test("nothing under app/ imports grant from lib/credits", () => {
    const offenders: string[] = [];
    const walk = (d: string): void => {
      for (const item of fs.readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, item.name);
        if (item.isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(item.name)) {
          const src = fs.readFileSync(full, "utf8");
          // Any import from the credits module that pulls in `grant`.
          for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*["'][^"']*credits["']/g)) {
            const named = m[1].split(",").map((s) => s.trim().split(/\s+as\s+/)[0].trim());
            if (named.includes("grant")) offenders.push(full);
          }
        }
      }
    };
    walk(path.join(process.cwd(), "app"));
    expect(offenders).toEqual([]);
  });
});
