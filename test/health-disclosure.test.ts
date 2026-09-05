import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { GET as health } from "@/app/api/health/route";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";

/**
 * B234 — what `/api/health` says to somebody who is not the operator.
 *
 * The page is unauthenticated by design and stays that way: an uptime monitor
 * cannot hold a credential, and everything a monitor asserts on is still
 * reachable without one. Two fields had drifted past "on or off":
 *
 * - `content.error` and `config.error` carried the **absolute content-root
 *   path** and the errno text, to anybody, and precisely when the instance was
 *   already unhealthy.
 * - `journals` named any journal that had narrowed a capability — **including
 *   one whose own config says `visibility: private`**, which is meant to be
 *   absent from `/documentation.txt`, the landing page and `sitemap.xml`.
 *
 * The line drawn: the *state* is public, the *detail* is not. `ok`, a
 * machine-readable `code`, and the whole `capabilities` block with its reasons
 * stay anonymous — AGENTS.md requires a capability that is off to explain
 * itself, and B197 requires an unreadable content root to be reportable here.
 * The path and the unadvertised names need `HEALTH_TOKEN`.
 *
 * **B473 moved the line once more**, and this file is where both positions are
 * recorded. B234 filtered `journals` through `listedUsernames()`; B473 takes
 * the block away from an unentitled caller entirely, because a listed
 * journal's capability posture is a fact about a deployment rather than about
 * a journal, and `journalsWithheld` was a live count of the journals that
 * asked not to be found. The same audit found `lib/api/openapi.ts` naming a
 * journal by `getUsernames()[0]` in a public document, four files from the
 * line that does it correctly; the last test here is that one.
 */

const TOKEN = "s3cret-health-token";
const PRIVATE_JOURNAL = "hidden";
const PUBLIC_JOURNAL = "shown";

let dir: string;

function writeJournal(username: string, visibility: "public" | "private") {
  fs.mkdirSync(path.join(dir, username), { recursive: true });
  fs.writeFileSync(
    path.join(dir, username, "config.json"),
    JSON.stringify({
      title: username,
      tagline: "t",
      owner: { name: "A B", nickname: "A", email: `${username}@example.test` },
      startLocation: "X",
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
      displayCurrencies: ["CHF"],
      units: "metric",
      ...(visibility === "private" ? { visibility } : {}),
      // Narrowed, which is the only reason a journal appears in `journals`
      // at all.
      features: { reactions: { enabled: false } },
    }),
  );
}

/** What an uptime monitor sends: no credential of any kind. */
const anonymous = () => new Request("https://example.test/api/health");
/** What the operator sends. */
const operator = (token = TOKEN) =>
  new Request("https://example.test/api/health", {
    headers: { authorization: `Bearer ${token}` },
  });

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-health-"));
  process.env.CONTENT_DIR = dir;
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "R", url: "https://example.test", defaultUser: PUBLIC_JOURNAL },
      users: { reserved: [] },
      features: { reactions: { enabled: true } },
    }),
  );
  writeJournal(PUBLIC_JOURNAL, "public");
  writeJournal(PRIVATE_JOURNAL, "private");
  clearConfigCache();
  clearUserCache();
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.HEALTH_TOKEN;
  clearUserCache();
});

afterAll(() => {
  delete process.env.CONTENT_DIR;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("what a stranger is told", () => {
  test("a monitor's assertions are unchanged", async () => {
    const response = await health(anonymous());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe("ok");
    expect(body.backup.state).toBeDefined();
    expect(typeof body.uptimeSeconds).toBe("number");
    expect(body.content).toEqual({ ok: true });
  });

  test("an unreadable content root is reported without its path", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(fs, "readdirSync").mockImplementation(() => {
      throw new Error("EACCES: permission denied");
    });
    clearUserCache();

    const response = await health(anonymous());
    expect(response.status).toBe(503);
    const body = await response.json();

    // B197's diagnostic survives: "cannot tell" is distinguishable from
    // "nothing to report", which is the whole reason the field exists.
    expect(body.status).toBe("error");
    expect(body.content.ok).toBe(false);
    expect(body.content.code).toBe("unreadable");
    // And the path does not. Asserted on the serialised body rather than on
    // the field, because the next field added is the one that leaks it.
    expect(body.content.error).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain(dir);
    expect(JSON.stringify(body)).not.toContain("EACCES");
  });

  test("a server-only capability is never narrowed per journal — B397", async () => {
    // Turn credits on at the server. It has no per-journal opt-in
    // (`creditsEnabled()` asks without a username), so no journal config sets
    // it — which used to make `resolveCapabilities(username)` report it as
    // "not enabled by <user>" and list it as narrowed for every journal, a
    // live-billed journal included. `logging` is skipped for the same reason;
    // this proves `credits` now is too.
    fs.writeFileSync(
      path.join(dir, "config.json"),
      JSON.stringify({
        site: { name: "R", url: "https://example.test", defaultUser: PUBLIC_JOURNAL },
        users: { reserved: [] },
        features: { reactions: { enabled: true }, credits: { enabled: true } },
      }),
    );
    // Credits needs a database to count as enabled at the server level; without
    // one the server answer and the per-journal answer would both be "off" and
    // the skip would never be exercised.
    process.env.DATABASE_URL = `sqlite:${path.join(dir, "health-credits.sqlite")}`;
    // Read as the operator: since B473 an unentitled caller has no `journals`
    // block to inspect, and the claim here is about what that block contains.
    process.env.HEALTH_TOKEN = TOKEN;
    clearConfigCache();
    clearUserCache();
    const { migrateToLatest } = await import("@/lib/db/migrate");
    const { getDatabase, closeDatabase } = await import("@/lib/db");
    await migrateToLatest(await getDatabase());
    try {
      const body = await (await health(operator())).json();
      // The public journal still appears (it narrowed `reactions`), but no
      // journal's block ever mentions credits — a whole-object check, because
      // the next field added is the one that reintroduces the leak.
      expect(body.journals[PUBLIC_JOURNAL]?.reactions.enabled).toBe(false);
      expect(JSON.stringify(body.journals)).not.toContain("credits");
      expect(body.capabilities.credits.enabled).toBe(true);
    } finally {
      await closeDatabase();
      delete process.env.DATABASE_URL;
      delete process.env.HEALTH_TOKEN;
      fs.writeFileSync(
        path.join(dir, "config.json"),
        JSON.stringify({
          site: { name: "R", url: "https://example.test", defaultUser: PUBLIC_JOURNAL },
          users: { reserved: [] },
          features: { reactions: { enabled: true } },
        }),
      );
      clearConfigCache();
      clearUserCache();
    }
  });

  test("no journal is named at all, advertised or not", async () => {
    // B234 filtered this list through `listedUsernames()`; B473 took the whole
    // block away from an unentitled caller. A listed journal's *name* is
    // public by design, but which capabilities it has switched on is a fact
    // about a deployment — and `journalsWithheld` was a live count of the
    // journals that asked not to be found.
    const body = await (await health(anonymous())).json();

    expect(body.journals, "absent, not empty — see the note in the route").toBeUndefined();
    expect(body.journalsWithheld).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain(PRIVATE_JOURNAL);
    expect(JSON.stringify(body)).not.toContain(PUBLIC_JOURNAL);
  });

  test("B197's diagnostic survives the redaction", async () => {
    // The constraint that makes taking the roster away safe. B197's complaint
    // was that an empty `journals` block reads exactly like an instance with
    // no journals, so nothing could say "cannot tell" rather than "nothing to
    // report". `content` is what says it, and it stays public.
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(fs, "readdirSync").mockImplementation(() => {
      throw new Error("EACCES: permission denied");
    });
    clearUserCache();
    try {
      const response = await health(anonymous());
      const body = await response.json();
      expect(response.status).toBe(503);
      expect(body.content).toEqual({ ok: false, code: "unreadable" });
      // The code, yes. The path it could not read, no.
      expect(JSON.stringify(body)).not.toContain(dir);
    } finally {
      vi.restoreAllMocks();
      clearUserCache();
    }
  });

  test("why a capability is off is still public", async () => {
    const body = await (await health(anonymous())).json();
    // AGENTS.md: "/api/health explains why something is off." Reasons name env
    // vars and config keys, never a value, a path or a person.
    expect(body.capabilities.push).toEqual({
      enabled: false,
      reason: "not enabled on this server",
    });
  });
});

describe("what the operator is told", () => {
  test("HEALTH_TOKEN brings back the path and the errno", async () => {
    process.env.HEALTH_TOKEN = TOKEN;
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(fs, "readdirSync").mockImplementation(() => {
      throw new Error("EACCES: permission denied");
    });
    clearUserCache();

    const body = await (await health(operator())).json();
    expect(body.content.ok).toBe(false);
    expect(body.content.error).toMatch(/EACCES/);
    expect(body.content.error).toContain(dir);
  });

  test("HEALTH_TOKEN brings back every journal, advertised or not", async () => {
    process.env.HEALTH_TOKEN = TOKEN;
    const body = await (await health(operator())).json();

    expect(body.journals[PRIVATE_JOURNAL]?.reactions.enabled).toBe(false);
    expect(body.journals[PUBLIC_JOURNAL]?.reactions.enabled).toBe(false);
    // The whole roster or none of it — there is no filtered middle any more,
    // so nothing counts what was dropped.
    expect(body.journalsWithheld).toBeUndefined();
  });

  test("a wrong token is a stranger, and so is an unset one", async () => {
    process.env.HEALTH_TOKEN = TOKEN;
    const wrong = await (await health(operator("not-the-token"))).json();
    expect(wrong.journals).toBeUndefined();

    // The dangerous default is the one where an operator who never set the
    // variable has been serving the full page all along.
    delete process.env.HEALTH_TOKEN;
    const unset = await (await health(operator())).json();
    expect(unset.journals).toBeUndefined();

    // An empty variable is not a token either — `Bearer ` would otherwise
    // match it.
    process.env.HEALTH_TOKEN = "";
    const empty = await (await health(operator(""))).json();
    expect(empty.journals).toBeUndefined();
  });
});

describe("the other public document that names a journal", () => {
  test("/openapi.json's example username never names an unadvertised journal", async () => {
    // B473. `getUsernames()` is sorted, so with no `defaultUser` the worked
    // example took whichever journal directory sorts first — and here that is
    // the private one, which is the whole point of the two fixture names.
    fs.writeFileSync(
      path.join(dir, "config.json"),
      JSON.stringify({
        site: { name: "R", url: "https://example.test" },
        users: { reserved: [] },
        features: { reactions: { enabled: true } },
      }),
    );
    clearConfigCache();
    clearUserCache();

    const { openApiDocument } = await import("@/lib/api/openapi");
    const document = JSON.stringify(openApiDocument());

    expect(PRIVATE_JOURNAL < PUBLIC_JOURNAL, "the fixture only bites if the private name sorts first").toBe(true);
    expect(document).not.toContain(PRIVATE_JOURNAL);
    expect(document).toContain(PUBLIC_JOURNAL);
  });
});
