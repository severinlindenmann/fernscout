import { describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  SHIPPED_SNIPPET,
  collectHandlers,
  describeHandler,
  isSubset,
  missingHandlers,
} from "../scripts/check-caddy.mts";

/**
 * `scripts/check-caddy.mts` — does the proxy that is running carry what this
 * release expects? (B66.)
 *
 * The comparison is the part worth testing, and it is pure: two Caddy JSON
 * configs in, the handlers missing from the second out. The JSON in these
 * fixtures is Caddy's own, produced by `caddy adapt` from the Caddyfiles next
 * to it and committed, so the whole file runs on a machine with no Caddy
 * installed — CI, and a laptop that has never served a page.
 *
 * Committed adapter output is a copy, and a copy rots. `regenerates the
 * fixtures` below is its keeper: wherever Caddy *is* installed it re-adapts
 * the same Caddyfiles and requires the result to match byte for byte, so the
 * fixtures cannot drift from what Caddy actually produces without a red test.
 * Run it with `UPDATE_CADDY_FIXTURES=1` to write them again after a change to
 * `deploy/fernscout.caddy`. That keeper skips where Caddy is not installed,
 * which today includes CI — B226.
 *
 * What none of this can do is look at fernscout.ch. Whether the *deployed*
 * proxy agrees is a question only the deployed proxy can answer, which is why
 * `scripts/deploy.sh` asks it on every deploy and prints the answer.
 */

const FIXTURES = path.join(process.cwd(), "test", "fixtures", "caddy");
const SCRIPT = path.join(process.cwd(), "scripts", "check-caddy.mts");

/** The domain the fixtures are adapted with. Host matchers are never compared
 * — only handlers are — so this is arbitrary and only has to be valid. */
const FIXTURE_DOMAIN = "journal.example";

const CASES = ["merged-ok", "merged-drifted", "imported"] as const;

function haveCaddy(): boolean {
  return spawnSync("caddy", ["version"], { stdio: "ignore" }).status === 0;
}
const HAS_CADDY = haveCaddy();

/** `caddy adapt`, as the script runs it. */
function adapt(file: string, domain: string): unknown {
  const res = spawnSync("caddy", ["adapt", "--config", file, "--adapter", "caddyfile"], {
    encoding: "utf8",
    env: { ...process.env, CADDY_DOMAIN: domain },
  });
  expect(res.status, res.stderr).toBe(0);
  return JSON.parse(res.stdout) as unknown;
}

function fixture(name: string): unknown {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES, `${name}.json`), "utf8")) as unknown;
}

/** What the release expects: `deploy/fernscout.caddy`, adapted. */
const expected = () => fixture("expected");

describe("check-caddy: what the release expects, against what is running", () => {
  test("a Caddyfile that carries the release's block is missing nothing", () => {
    expect(missingHandlers(expected(), fixture("merged-ok"))).toEqual([]);
  });

  test("a Caddyfile that drifted is missing the directive, by name", () => {
    // The B01 state, exactly: the site block is there, the site works, and
    // `header_up X-Forwarded-For` is gone. A deploy called that machine
    // healthy for a day.
    const missing = missingHandlers(expected(), fixture("merged-drifted"));
    expect(missing).toHaveLength(1);
    expect(describeHandler(missing[0])).toContain("X-Forwarded-For");
    expect(describeHandler(missing[0])).toContain("127.0.0.1:3000");
  });

  test("an imported snippet delivers the release's block without touching the neighbour", () => {
    // Acceptance, both halves at once: nothing is missing, *and* the other
    // site is still being served from the same config. An import that had
    // clobbered the neighbour would pass the first assertion on its own.
    const running = fixture("imported");
    expect(missingHandlers(expected(), running)).toEqual([]);
    expect(collectHandlers(running).map((h) => h.handler)).toContain("static_response");
  });

  test("a release that adds a directive is missing from a machine that has not taken it", () => {
    // The forward-looking half of B66: not "is B01 still applied", but "does
    // the next proxy directive reach an existing machine". Adding one to the
    // expectation must turn a machine that was agreeing into one that is not.
    const withExtra = JSON.parse(JSON.stringify(expected())) as unknown;
    const handlers = collectHandlers(withExtra);
    const proxy = handlers.find((h) => h.handler === "reverse_proxy");
    expect(proxy).toBeDefined();
    const set = ((proxy!.headers as Record<string, unknown>).request as Record<string, unknown>).set as Record<
      string,
      unknown
    >;
    set["X-Real-Ip"] = ["{http.request.remote.host}"];

    expect(missingHandlers(withExtra, fixture("merged-ok"))).toHaveLength(1);
    // And the machine that imports keeps up by construction — the same
    // expectation against the imported config is only satisfied once the
    // snippet itself changes, which is the point: it is one file.
    expect(missingHandlers(withExtra, fixture("imported"))).toHaveLength(1);
  });

  test("a machine may add its own directives without counting as drift", () => {
    // A shared host is the normal case and its operator has their own reasons.
    // The check asks whether ours is present, never whether theirs is absent.
    const running = JSON.parse(JSON.stringify(fixture("merged-ok"))) as unknown;
    const proxy = collectHandlers(running).find((h) => h.handler === "reverse_proxy");
    const set = ((proxy!.headers as Record<string, unknown>).request as Record<string, unknown>).set as Record<
      string,
      unknown
    >;
    set["X-Their-Own-Header"] = ["something"];

    expect(missingHandlers(expected(), running)).toEqual([]);
  });

  test("isSubset does not confuse a missing value with a present one", () => {
    // The comparison is the whole check, so its edges are asserted rather than
    // assumed: a subset that matched everything would make this file green
    // against any config at all.
    expect(isSubset({ a: 1 }, { a: 1, b: 2 })).toBe(true);
    expect(isSubset({ a: 1 }, { a: 2 })).toBe(false);
    expect(isSubset({ a: 1 }, {})).toBe(false);
    expect(isSubset([1, 2], [2, 3, 1])).toBe(true);
    expect(isSubset([1, 4], [2, 3, 1])).toBe(false);
    expect(isSubset({ a: { b: 1 } }, { a: {} })).toBe(false);
    expect(isSubset("x", "x")).toBe(true);
    expect(isSubset("x", "y")).toBe(false);
  });
});

describe("check-caddy: as a program", () => {
  function run(args: string[]): { status: number; stdout: string; stderr: string } {
    const res = spawnSync("npx", ["tsx", SCRIPT, ...args], { encoding: "utf8" });
    return { status: res.status ?? -1, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
  }

  const json = (name: string) => path.join(FIXTURES, `${name}.json`);

  test("exits 0, and says so, when the running config agrees", () => {
    const res = run(["--expected", json("expected"), "--running", json("imported")]);
    expect(res.status).toBe(0);
    expect(res.stdout).toMatch(/carries what this release expects/);
  }, 60_000);

  test("exits 1 and names both the drift and the fix", () => {
    const res = run(["--expected", json("expected"), "--running", json("merged-drifted")]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("X-Forwarded-For");
    // A warning nobody can act on is how B66 happened in the first place, so
    // the import line an operator should add is in the output.
    expect(res.stderr).toContain("import ");
    expect(res.stderr).toContain("deploy/fernscout.caddy");
  }, 60_000);

  test("exits 2 — not 0, and not 1 — when it could not ask the question", () => {
    // The distinction deploy.sh needs: "the proxy is wrong" and "I could not
    // find out" are different sentences, and reporting the second as the first
    // would make every deploy on a machine without Caddy shout about drift.
    const res = run(["--expected", json("expected"), "--config", path.join(os.tmpdir(), "no-such-caddyfile")]);
    expect(res.status).toBe(2);
    expect(res.stderr).toMatch(/no Caddy config/);
  }, 60_000);
});

describe("check-caddy: the fixtures are what Caddy actually produces", () => {
  // Skipped where Caddy is not installed — including CI. It is the keeper for
  // committed adapter output, not the check itself: everything above runs
  // everywhere, on the JSON this test is responsible for.
  test.skipIf(!HAS_CADDY)("regenerates the fixtures, and they do not change", () => {
    const update = process.env.UPDATE_CADDY_FIXTURES === "1";
    const produced: Record<string, unknown> = {
      expected: adapt(SHIPPED_SNIPPET, "fernscout.invalid"),
    };
    for (const name of CASES) {
      produced[name] = adapt(path.join(FIXTURES, `${name}.Caddyfile`), FIXTURE_DOMAIN);
    }

    for (const [name, value] of Object.entries(produced)) {
      const file = path.join(FIXTURES, `${name}.json`);
      if (update) {
        fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
        continue;
      }
      expect(
        JSON.parse(fs.readFileSync(file, "utf8")),
        `${name}.json is stale — re-run with UPDATE_CADDY_FIXTURES=1 and read the diff`,
      ).toEqual(value);
    }
  }, 60_000);
});
