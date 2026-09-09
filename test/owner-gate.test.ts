import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { SESSION_SCOPE, type Session } from "@/lib/auth";

/**
 * Every owner-only gate is one scope string away from opening — B240.
 *
 * `mayActAsOwner` (`lib/api/auth.ts`) is now the one question every owner-only
 * gate in the write API asks, replacing fourteen call sites that each
 * re-derived `session.scope !== SESSION_SCOPE.agent` on their own:
 *
 *   app/api/v1/[user]/route.ts (DELETE the journal)
 *   app/api/v1/[user]/config/route.ts (GET, PATCH)
 *   app/api/v1/[user]/inbox/route.ts (GET, POST)
 *   app/api/v1/[user]/inbox/[id]/route.ts (DELETE)
 *   app/api/v1/[user]/import/route.ts (GET, POST)
 *   app/api/v1/[user]/trips/route.ts (POST, and the malformed-trips reveal)
 *   app/api/v1/[user]/trips/[trip]/route.ts (DELETE, PATCH)
 *   app/api/v1/[user]/trips/[trip]/rates/route.ts (PUT)
 *   app/api/v1/[user]/trips/[trip]/visibility/route.ts (PUT)
 *   app/api/v1/[user]/trips/[trip]/track/route.ts (POST)
 *   app/api/v1/[user]/trips/[trip]/days/[slug]/publish/route.ts (POST)
 *   app/api/v1/[user]/trips/[trip]/days/[slug]/send-mail/route.ts (POST)
 *   app/api/v1/[user]/trips/[trip]/days/[slug]/send-whatsapp/route.ts (POST)
 *   lib/api/tripParty.ts (people/travellers/tracks routes' shared resolver)
 *   lib/api/status.ts (the malformed-trips and credit-balance reveal)
 *   app/[user]/export.zip/route.ts (owner-only archive, B1086)
 *
 * Two halves, because either alone misses what B240 is about. A per-route test
 * ("a trip-scoped token gets 403 here") is the case-by-case check the ticket
 * says is not the point — it would pass today and say nothing about the
 * *next* route. So: a unit test of `mayActAsOwner` itself (including the
 * defense-in-depth case a scope-widening bug like B230 would need to survive),
 * and a source scan proving no file outside `lib/api/auth.ts` still compares
 * `session.scope` against `SESSION_SCOPE.agent` directly — which is exactly
 * what would let a fifteenth gate reinvent the mistake.
 */

let dir: string;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-owner-gate-"));
  process.env.CONTENT_DIR = dir;
  process.env.FERNSCOUT_ADMIN_EMAIL = "";
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "R", url: "https://example.test", defaultUser: "ana" },
      users: { reserved: [] },
    }),
  );
  fs.mkdirSync(path.join(dir, "ana"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "ana", "config.json"),
    JSON.stringify({
      title: "Two Backpacks",
      owner: { name: "Ana Meyer", nickname: "Ana", email: "ana@example.test" },
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
    }),
  );
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function session(over: Partial<Session>): Session {
  return {
    id: "s1",
    userId: "u1",
    owner: "ana",
    kind: "agent",
    scope: SESSION_SCOPE.agent,
    email: "ana@example.test",
    publicId: null,
    phone: null,
    phoneProvenAt: null,
    ...over,
  };
}

describe("mayActAsOwner", () => {
  test("the owner's own unqualified token passes", async () => {
    const { mayActAsOwner } = await import("@/lib/api/auth");
    expect(mayActAsOwner(session({}), "ana")).toBe(true);
  });

  test("a trip-scoped token for the same journal is refused", async () => {
    const { mayActAsOwner } = await import("@/lib/api/auth");
    expect(mayActAsOwner(session({ scope: "write:trip:alps-2024" }), "ana")).toBe(false);
  });

  test("a token for a different journal is refused", async () => {
    const { mayActAsOwner } = await import("@/lib/api/auth");
    expect(mayActAsOwner(session({ owner: "someoneelse" }), "ana")).toBe(false);
  });

  /**
   * The defense-in-depth case B240 was filed for: a scope that was somehow
   * minted as the unqualified `write:content` (a B230-shaped bug) for a
   * session bound to the right journal, but whose address is not the one
   * `config.json` names as its owner. `ownsUser` alone — which only asks
   * "which journal" — would pass this; `mayActAsOwner` must not, because it
   * asks a second, independent question of the journal's own config file
   * rather than trusting the token's own metadata twice.
   */
  test("a widened scope is still refused when the address does not match the journal's owner", async () => {
    const { mayActAsOwner } = await import("@/lib/api/auth");
    const widened = session({
      scope: SESSION_SCOPE.agent,
      owner: "ana",
      email: "robin@example.test",
    });
    expect(mayActAsOwner(widened, "ana")).toBe(false);
  });

  test("the instance admin passes regardless of the journal's own owner.email", async () => {
    process.env.FERNSCOUT_ADMIN_EMAIL = "admin@example.test";
    const { mayActAsOwner } = await import("@/lib/api/auth");
    expect(
      mayActAsOwner(session({ owner: "ana", email: "admin@example.test" }), "ana"),
    ).toBe(true);
    process.env.FERNSCOUT_ADMIN_EMAIL = "";
  });
});

describe("no owner-only gate re-derives the scope check on its own", () => {
  test("only lib/api/auth.ts compares a session's scope against SESSION_SCOPE.agent", () => {
    const roots = ["app", "lib"];
    const offenders: string[] = [];
    const pattern = /session\.scope\s*(?:!==|===)\s*SESSION_SCOPE\.agent/;

    function walk(dirPath: string) {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dirPath, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const full = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
          walk(full);
        } else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith(".test.ts")) {
          const rel = path.relative(process.cwd(), full);
          if (rel === path.join("lib", "api", "auth.ts")) continue;
          const source = fs.readFileSync(full, "utf8");
          if (pattern.test(source)) offenders.push(rel);
        }
      }
    }

    for (const root of roots) walk(path.join(process.cwd(), root));
    expect(offenders).toEqual([]);
  });
});
