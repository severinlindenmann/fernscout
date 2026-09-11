import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import {
  auditOwner,
  balanceOf,
  grant,
  ledgerFor,
  refund,
  spend,
  spentByReason,
} from "@/lib/credits";
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

  test("spends are grouped by reason, positive, biggest first, grants excluded", async () => {
    await grant("alice", 100);
    await spend("alice", 3, "helper", "alice/t/a");
    await spend("alice", 2, "helper", "alice/t/b");
    await spend("alice", 9, "day_whatsapp", "alice/t/c");
    await refund("alice", 1, "alice/t/a");

    // The refund is a credit back, not a spend, and neither is the grant —
    // but B922 says it must still be legible, as its own line rather than
    // netted into `helper`.
    expect(await spentByReason("alice")).toEqual([
      { reason: "day_whatsapp", credits: 9 },
      { reason: "helper", credits: 5 },
      { reason: "refunded", credits: 1 },
    ]);
    expect(await spentByReason("nobody")).toEqual([]);
  });

  test("B922: a refund shows as its own line, not silently netted out of the reason it came from", async () => {
    await grant("alice", 10);
    // The model ran and was charged, then the write failed underneath it.
    await spend("alice", 1, "helper", "alice/t/2026-09-07");
    await refund("alice", 1, "alice/t/2026-09-07");
    expect(await balanceOf("alice")).toBe(10);
    // Before this fix, a fully-refunded call vanished from the breakdown
    // entirely (delta<0 excludes it, delta>0 was never read) — a person
    // could not tell the call had happened, let alone that it came back.
    expect(await spentByReason("alice")).toEqual([
      { reason: "helper", credits: 1 },
      { reason: "refunded", credits: 1 },
    ]);
  });

  test("the ledger always sums to the balance", async () => {
    await grant("alice", 100);
    await spend("alice", 30, "day_mail", "alice/t/a");
    await spend("alice", 500, "day_mail", "alice/t/b"); // refused, writes nothing
    await refund("alice", 4, "alice/t/a");
    await spend("alice", 12, "day_whatsapp", "alice/t/c");
    await spend("alice", 2, "digest", "alice/digest/2026-09-04");
    await grant("alice", 7, "invoice 2");

    const audit = await auditOwner("alice");
    expect(audit.balance).toBe(100 - 30 + 4 - 12 - 2 + 7);
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

  test("a hundredth is a real charge, and anything finer is a programming error", async () => {
    // B987 — the stored unit is a hundredth of a credit, so 1.5 is now an
    // ordinary amount and 0.005 is the mistake `Number.isInteger` used to
    // catch. Rounding it silently would make a pricing bug invisible until an
    // invoice disagreed.
    await grant("alice", 10);
    expect(await spend("alice", 1.5, "day_mail", "alice/t/d")).toBe(true);
    expect(await balanceOf("alice")).toBe(8.5);
    expect(await spend("alice", 0.01, "day_mail", "alice/t/d2")).toBe(true);
    expect(await balanceOf("alice")).toBe(8.49);
    await expect(spend("alice", 0.005, "day_mail", "alice/t/d3")).rejects.toThrow(
      /hundredths/,
    );
  });

  test("a balance of one hundredth cannot pay for two", async () => {
    await grant("alice", 1);
    expect(await spend("alice", 0.99, "day_mail", "alice/t/a")).toBe(true);
    expect(await balanceOf("alice")).toBe(0.01);
    expect(await spend("alice", 0.02, "day_mail", "alice/t/b")).toBe(false);
    expect(await spend("alice", 0.01, "day_mail", "alice/t/c")).toBe(true);
    expect(await balanceOf("alice")).toBe(0);
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
  // Since B425 there is one sanctioned exception: the operator approve route,
  // which grants after a single-use token (mailed only to site.operatorEmail)
  // is spent atomically. B688 adds a second: the journal-creation route
  // grants a fixed `SIGNUP_CREDIT_GRANT` exactly once, only after a journal
  // has actually been written under a freshly spent signup token — see
  // property 1 in the module comment. Anything else importing grant still
  // fails, which keeps a third, unreviewed grant path from appearing.
  const GRANT_ALLOWED = [
    "app/api/v1/[user]/payments/[id]/approve/route.ts",
    "app/api/v1/journals/route.ts",
    // B792. Stripe's signed webhook, behind a once-only claim — the same two
    // guarantees the approve route above rests on, from a credential this
    // server verified rather than a session or a bearer token.
    "app/api/webhooks/stripe/route.ts",
    /**
     * B1363. The WhatsApp signup gives the identical fixed
     * `SIGNUP_CREDIT_GRANT` the journals route above gives, under the
     * identical condition — after a journal has actually been written, for a
     * proven address and a proven number — because the two are the same act
     * through two doors, and a journal created over WhatsApp whose first day
     * refuses for want of credits would be a worse answer than either.
     *
     * It is also the first grant caller outside `app/`, which is why the walk
     * below covers `lib/` now: this guard was written when every route was a
     * route, and a grant reached from a library was invisible to it.
     */
    "lib/whatsapp/onboarding.ts",
  ];

  test("only the sanctioned routes import grant from lib/credits", () => {
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
            const rel = path.relative(process.cwd(), full);
            if (named.includes("grant") && !GRANT_ALLOWED.includes(rel)) offenders.push(rel);
          }
        }
      }
    };
    walk(path.join(process.cwd(), "app"));
    walk(path.join(process.cwd(), "lib"));
    expect(offenders).toEqual([]);
  });

  test("the allowed grant importer exists and imports grant (allowlist not stale)", () => {
    for (const rel of GRANT_ALLOWED) {
      const full = path.join(process.cwd(), rel);
      expect(fs.existsSync(full)).toBe(true);
      expect(fs.readFileSync(full, "utf8")).toMatch(/\bgrant\b/);
    }
  });

  // B832. `refund` raises a balance too, so it deserves the same mechanised
  // guard as `grant` — the invariant "only sanctioned code adds credits" was
  // enforced for one of the two raising functions and merely asserted in a
  // comment for the other. Every caller today refunds exactly what a matching
  // spend took, on provider failure, so there is no free-credit path — but a
  // future route that refunds a caller-named amount with no matching spend
  // would mint credits and no test would fail. This makes adding a refund
  // caller a deliberate, reviewed act, the same way adding a grant caller is.
  const REFUND_ALLOWED = [
    "app/api/helper/[user]/statement/route.ts",
    "app/api/helper/[user]/day/write-day/route.ts",
    "app/api/helper/[user]/day/describe-photos/route.ts",
    "app/api/helper/[user]/transcribe/route.ts",
    // B1091. `ask` and `search` now charge `HELPER_TURN_CREDITS` before
    // their one model call and give it back if the call throws — the same
    // shape as every route above.
    "app/api/helper/[user]/ask/route.ts",
    "app/api/helper/[user]/search/route.ts",
    // B1517. One photograph classified into a proposed party — charged
    // before the model call, refunded on a throw, the same shape as every
    // route above.
    "app/api/v1/[user]/trips/[trip]/travellers/from-photo/route.ts",
  ];

  test("only the sanctioned routes import refund from lib/credits", () => {
    const offenders: string[] = [];
    const walk = (d: string): void => {
      for (const item of fs.readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, item.name);
        if (item.isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(item.name)) {
          const src = fs.readFileSync(full, "utf8");
          for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*["'][^"']*credits["']/g)) {
            const named = m[1].split(",").map((s) => s.trim().split(/\s+as\s+/)[0].trim());
            const rel = path.relative(process.cwd(), full);
            if (named.includes("refund") && !REFUND_ALLOWED.includes(rel)) offenders.push(rel);
          }
        }
      }
    };
    walk(path.join(process.cwd(), "app"));
    expect(offenders).toEqual([]);
  });

  test("the allowed refund importers exist and import refund (allowlist not stale)", () => {
    for (const rel of REFUND_ALLOWED) {
      const full = path.join(process.cwd(), rel);
      expect(fs.existsSync(full)).toBe(true);
      expect(fs.readFileSync(full, "utf8")).toMatch(/\brefund\b/);
    }
  });
});

/**
 * B1091's own finding, mechanised. `answerInThread` and `findInJournal` sat
 * in `lib/helper/model.ts` beside `writeDay`, built the identical
 * `new Anthropic()`, and were free — nothing here ever asked "who calls the
 * thing that costs money" of either. This asks it of every export in that
 * file that builds an `Anthropic` client, and of the one export in
 * `lib/helper/transcribe.ts` that reaches Deepgram — broader than the two
 * routes B1091 named, so the next paid export added there is covered by
 * construction rather than by somebody remembering to add a line here.
 *
 * The same trade `GRANT_ALLOWED`/`REFUND_ALLOWED` above make: an
 * import-presence check, not a read of execution order. A file that never
 * imports `spend` cannot be the one guarding a paid call, whatever order its
 * own lines run in; a file that does still has to have got the order right,
 * which is what the route-level `no_credits` behaviour above and the
 * per-route reading in `AGENTS.md`'s own review verify.
 */
describe("every paid model call is reached only from a file that spends first", () => {
  /** Comments quote call shapes in prose (`lib/helper/caller.ts` names
   *  `answerInThread(username, …)` while explaining something else
   *  entirely) — stripped so a doc comment cannot fake a caller. */
  function withoutComments(src: string): string {
    return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  }

  /** Every export in `file` whose body constructs `new Anthropic()`. */
  function pricedExports(file: string): string[] {
    const src = withoutComments(fs.readFileSync(path.join(process.cwd(), file), "utf8"));
    const names: string[] = [];
    for (const part of src.split(/\n(?=export (?:async )?function )/)) {
      const m = part.match(/^export (?:async )?function (\w+)/);
      if (m && part.includes("new Anthropic()")) names.push(m[1]);
    }
    return names;
  }

  /**
   * Every file outside `own` that calls `name(`. `lib/helper/tools/` is
   * excluded on purpose: those are the tools `answerInThread` itself runs
   * mid-turn (`runTool`, `lib/helper/tools.ts`), so a nested `findInJournal`
   * reached that way sits inside a turn the *route* already charged once,
   * flat, for the whole turn — it is not a second door a second spend
   * belongs on.
   */
  function callersOf(name: string, own: string): string[] {
    const found = new Set<string>();
    const walk = (d: string): void => {
      for (const item of fs.readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, item.name);
        const rel = path.relative(process.cwd(), full);
        if (item.isDirectory()) {
          if (rel === "lib/helper/tools") continue;
          walk(full);
        } else if (/\.(ts|tsx)$/.test(item.name) && rel !== own) {
          const src = withoutComments(fs.readFileSync(full, "utf8"));
          if (new RegExp(`\\b${name}\\(`).test(src)) found.add(rel);
        }
      }
    };
    walk(path.join(process.cwd(), "app"));
    walk(path.join(process.cwd(), "lib"));
    return [...found];
  }

  test("every Anthropic-calling export in lib/helper/model.ts is only reached from a file that imports spend", () => {
    const priced = pricedExports("lib/helper/model.ts");
    // Not stale: this is the list B1091 found, and a fifth one added later
    // without a spend around it is exactly what this test exists to catch.
    expect(priced).toEqual(
      expect.arrayContaining([
        "writeDay",
        "describePhotos",
        "mapStatementColumns",
        "answerInThread",
        "findInJournal",
      ]),
    );
    const offenders: string[] = [];
    for (const name of priced) {
      for (const caller of callersOf(name, "lib/helper/model.ts")) {
        const src = fs.readFileSync(path.join(process.cwd(), caller), "utf8");
        if (!/\bspend\b/.test(src)) offenders.push(`${caller} calls ${name}() without importing spend`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test("transcribeAudio, the one Deepgram door, is only reached from a file that imports spend", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "lib/helper/transcribe.ts"), "utf8");
    expect(src).toMatch(/deepgram/);
    const callers = callersOf("transcribeAudio", "lib/helper/transcribe.ts");
    expect(callers.length).toBeGreaterThan(0);
    for (const caller of callers) {
      expect(fs.readFileSync(path.join(process.cwd(), caller), "utf8")).toMatch(/\bspend\b/);
    }
  });
});
