import { afterEach, describe, expect, test } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { INSTANCE_DIRS } from "@/lib/users";

/**
 * `scripts/sync-shipped-content.sh`, which a deploy runs against somebody's
 * journal folder.
 *
 * The bug it fixes (B56) is boring — a `git pull` updates the repository's
 * `content/locales/` and the app reads `$CONTENT_DIR`, so a translation
 * shipped today reached nobody. The bug it could *cause* is not: the same
 * script, one directory too wide, would replace `<username>/` with whatever
 * the repository happens to hold and take a person's writing with it. So the
 * interesting assertions here are the ones about what does **not** change.
 */

const run = promisify(execFile);
const script = path.join(process.cwd(), "scripts", "sync-shipped-content.sh");

const temps: string[] = [];

function tempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  temps.push(dir);
  return dir;
}

afterEach(() => {
  while (temps.length) fs.rmSync(temps.pop()!, { recursive: true, force: true });
});

/**
 * A repository content/ folder.
 *
 * It holds the operator-owned half too — a `config.json` and the `example`
 * journal, exactly as the repository does — because those are what a blanket
 * copy would push over somebody's own. A fixture with only `locales/` and
 * `rates/` in it cannot tell a careful sync from a reckless one.
 */
function makeRepo(strings: Record<string, string>): string {
  const app = tempDir("fernscout-repo-");
  fs.mkdirSync(path.join(app, "content", "locales"), { recursive: true });
  fs.mkdirSync(path.join(app, "content", "rates"), { recursive: true });
  fs.mkdirSync(path.join(app, "content", "example", "trips"), { recursive: true });
  fs.writeFileSync(path.join(app, "content", "config.json"), '{"configVersion":1,"repo":true}\n');
  fs.writeFileSync(path.join(app, "content", "example", "config.json"), '{"title":"Example"}\n');
  fs.writeFileSync(
    path.join(app, "content", "locales", "en.json"),
    `${JSON.stringify(strings, null, 2)}\n`,
  );
  fs.writeFileSync(
    path.join(app, "content", "rates", "ecb.json"),
    JSON.stringify({ date: "2026-09-01", rates: { CHF: 0.94 } }),
  );
  return app;
}

/** A deployed content folder: journals, an operator config, a stale seed copy. */
function makeContentDir(): string {
  const dir = tempDir("fernscout-content-");
  fs.writeFileSync(path.join(dir, "config.json"), '{"configVersion":1}\n');
  fs.mkdirSync(path.join(dir, "sevi", "trips", "iceland", "entries"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "sevi", "trips", "iceland", "trip.md"),
    "---\ntitle: Iceland\n---\n",
  );
  fs.writeFileSync(path.join(dir, "sevi", "config.json"), '{"title":"Sevi"}\n');
  fs.mkdirSync(path.join(dir, "locales"));
  fs.writeFileSync(
    path.join(dir, "locales", "en.json"),
    JSON.stringify({ "nav.home": "Old home", "me.newHere": "deleted upstream" }),
  );
  return dir;
}

/** Every file under a directory, with its contents — for comparing before and after. */
function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (rel: string) => {
    for (const entry of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const next = path.join(rel, entry.name);
      if (entry.isDirectory()) walk(next);
      else out[next] = fs.readFileSync(path.join(dir, next), "utf8");
    }
  };
  walk(".");
  return out;
}

function sync(app: string, contentDir: string) {
  return run("bash", [script], { env: { ...process.env, APP_DIR: app, CONTENT_DIR: contentDir } });
}

describe("sync-shipped-content.sh", () => {
  test("replaces the shipped directories with the repository's copies", async () => {
    const app = makeRepo({ "nav.home": "Home", "nav.map": "Map" });
    const content = makeContentDir();

    await sync(app, content);

    for (const name of ["locales/en.json", "rates/ecb.json"]) {
      expect(fs.readFileSync(path.join(content, name), "utf8")).toBe(
        fs.readFileSync(path.join(app, "content", name), "utf8"),
      );
    }
  });

  test("a key deleted from the repository is gone afterwards", async () => {
    const app = makeRepo({ "nav.home": "Home" });
    const content = makeContentDir();
    expect(fs.readFileSync(path.join(content, "locales", "en.json"), "utf8")).toContain(
      "me.newHere",
    );

    await sync(app, content);

    // Replaced, not merged: a merge would have kept the deleted key, which is
    // exactly why the live server was still serving `me.newHere`.
    const after = JSON.parse(fs.readFileSync(path.join(content, "locales", "en.json"), "utf8"));
    expect(after).toEqual({ "nav.home": "Home" });
  });

  test("config.json and every journal directory are untouched", async () => {
    const app = makeRepo({ "nav.home": "Home" });
    const content = makeContentDir();
    const before = snapshot(content);
    const owned = (s: Record<string, string>) =>
      Object.fromEntries(
        Object.entries(s).filter(([k]) => !k.startsWith("locales/") && !k.startsWith("rates/")),
      );
    const stat = (p: string) => fs.statSync(path.join(content, p)).mtimeMs;
    const mtimes = {
      config: stat("config.json"),
      trip: stat("sevi/trips/iceland/trip.md"),
    };

    await sync(app, content);

    expect(owned(snapshot(content))).toEqual(owned(before));
    expect(stat("config.json")).toBe(mtimes.config);
    expect(stat("sevi/trips/iceland/trip.md")).toBe(mtimes.trip);
    // And nothing new at the top level either — no staging directory left
    // behind for `getUsernames()` to trip over.
    expect(fs.readdirSync(content).sort()).toEqual(["config.json", "locales", "rates", "sevi"]);
  });

  test("an instance that marks a directory .keep-local keeps it", async () => {
    const app = makeRepo({ "nav.home": "Home" });
    const content = makeContentDir();
    fs.writeFileSync(path.join(content, "locales", ".keep-local"), "");
    const mine = fs.readFileSync(path.join(content, "locales", "en.json"), "utf8");

    const { stdout } = await sync(app, content);

    expect(fs.readFileSync(path.join(content, "locales", "en.json"), "utf8")).toBe(mine);
    expect(stdout).toContain(".keep-local");
    // The unmarked one is still synced.
    expect(fs.existsSync(path.join(content, "rates", "ecb.json"))).toBe(true);
  });

  test("a CONTENT_DIR that is the repository's own content/ is a no-op", async () => {
    const app = makeRepo({ "nav.home": "Home" });
    const { stdout } = await sync(app, path.join(app, "content"));
    expect(stdout).toContain("nothing to copy");
  });

  test("a missing CONTENT_DIR fails loudly rather than creating one", async () => {
    const app = makeRepo({ "nav.home": "Home" });
    const missing = path.join(tempDir("fernscout-content-"), "not-there");
    await expect(sync(app, missing)).rejects.toThrow(/does not exist/);
    expect(fs.existsSync(missing)).toBe(false);
  });

  test("the shipped list is the same list lib/users.ts calls not-people", () => {
    const source = fs.readFileSync(script, "utf8");
    const declared = /^SHIPPED=\(([^)]*)\)$/m.exec(source);
    expect(declared).not.toBeNull();
    const names = declared![1].trim().split(/\s+/).sort();
    // One list, two languages. A third instance directory added to lib/users.ts
    // and not to the deploy would silently stop shipping.
    expect(names).toEqual([...INSTANCE_DIRS].sort());
  });
});
