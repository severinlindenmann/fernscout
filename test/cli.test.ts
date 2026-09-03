import { describe, expect, test } from "vitest";
import { execFile, spawnSync } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import fs from "node:fs";
import path from "node:path";

/**
 * The CLIs, checked for the failure they all share.
 *
 * Several of them read content through `lib/`, which is guarded by
 * `server-only` — a module that throws on import outside a React Server
 * Component. That guard is right for the app and wrong for a script, so those
 * CLIs run under `--conditions=react-server`, which resolves the guard to an
 * empty module. Forgetting it produces a CLI that fails on its very first line,
 * and nothing else in the suite would notice.
 */

const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"));
const scripts: Record<string, string> = pkg.scripts;

/** Scripts that read content through `lib/`, and so need the condition.
 * `ingest` was missing from this list, and from any check that ran it, which
 * is how B84 happened: it was plain `node` on a `.ts` file — no condition, no
 * extension resolution, top-level await under a CJS transform — and every
 * static check below passed while `npm run ingest` could not start. */
const CONTENT_READING = [
  "ingest",
  "alert",
  "export",
  "photobook",
  "db:migrate",
  "db:status",
  "db:import",
];

describe("CLI wiring", () => {
  for (const name of CONTENT_READING) {
    test(`${name} runs with the react-server condition`, () => {
      expect(scripts[name]).toBeDefined();
      expect(scripts[name]).toContain("--conditions=react-server");
    });
  }

  test("every script points at a file that exists", () => {
    const missing: string[] = [];
    for (const [name, command] of Object.entries(scripts)) {
      const match = command.match(/(scripts\/[\w.-]+)/);
      if (match && !fs.existsSync(path.join(process.cwd(), match[1]))) {
        missing.push(`${name} -> ${match[1]}`);
      }
    }
    expect(missing).toEqual([]);
  });

  /**
   * update-rates lost its target list to an over-broad edit once already.
   *
   * Served from a local socket rather than from ecb.europa.eu. This ran
   * against the live bank, so a checkout on a train — or CI on a bad
   * afternoon — failed on a test that has nothing to do with the network,
   * which is the kind of red build people learn to re-run without reading.
   */
  test("update-rates parses the table and names the file it would write", async () => {
    const xml =
      `<?xml version="1.0" encoding="UTF-8"?><gesmes:Envelope ` +
      `xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01">` +
      `<Cube><Cube time='2026-08-28'>` +
      `<Cube currency='USD' rate='1.1643'/><Cube currency='CHF' rate='0.9312'/>` +
      `</Cube></Cube></gesmes:Envelope>`;

    const server = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "application/xml" });
      res.end(xml);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;

    try {
      // `execFile`, not `execFileSync`: the fixture is served from this very
      // process, and the synchronous form blocks the event loop that would
      // answer the request — the child waits for a reply nobody can send.
      const { stdout: out } = await promisify(execFile)(
        "node",
        ["scripts/update-rates.mjs", "--dry-run"],
        { env: { ...process.env, ECB_RATES_URL: `http://127.0.0.1:${port}/` } },
      );
      expect(out).toContain("content/rates/ecb.json");
      // The date is the bank's own publication date, not the day it ran.
      expect(out).toContain("2026-08-28");
      expect(out).toContain("2 rates");
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
    }
  }, 20_000);
});

/**
 * The static checks above assert a script *names* the condition and *points* at
 * a file. Neither can see a script that does both and still fails to load — the
 * failure that stopped `ingest` (B84). Three shapes of it, none caught by a
 * grep over the command string:
 *
 * - a relative import with no extension, which Node's ESM resolver will not
 *   complete (the bundler and Vitest both add it, so nothing else here notices);
 * - top-level await in a `.ts` file, which tsx transforms as CJS and rejects —
 *   the reason the working scripts are `.mts`;
 * - a `server-only` guard reached because the react-server condition was on the
 *   wrong runner.
 *
 * So these actually run each entry point, with an argument that reaches its own
 * validation and stops there — an info flag, or an unknown user. Every probe is
 * side-effect-free: nothing is written, sent or downloaded. The command comes
 * from `package.json`, so the runner under test is the one that ships.
 */
const LOAD_FAILURES = [
  "ERR_MODULE_NOT_FOUND",
  "Cannot find module",
  "cannot be imported from a Client Component", // server-only, wrong runner
  "Top-level await is currently not supported", // an ESM script transformed as CJS
  "Transform failed",
];

/** name → an argument set that reaches the script's own code and does nothing. */
const PROBES: Record<string, string[]> = {
  ingest: ["--tools"],
  postcard: ["--providers"],
  export: ["fs-smoke-no-such-user"],
  digest: ["--user", "fs-smoke-no-such-user", "--dry-run"],
  "migrate:users": ["--user", "fs-smoke-no-such-user", "--dry-run"],
  "migrate:owner": ["--user", "fs-smoke-no-such-user", "--dry-run"],
};

describe("CLI entry points load", () => {
  // node_modules/.bin on PATH so the declared runner (`tsx`) resolves when the
  // command is run directly rather than through `npm run`, which keeps the
  // output to the script's own — no npm banner to make the emptiness check lie.
  const env = {
    ...process.env,
    PATH: `${path.join(process.cwd(), "node_modules", ".bin")}${path.delimiter}${process.env.PATH ?? ""}`,
  };

  for (const [name, args] of Object.entries(PROBES)) {
    test(`${name} starts without a load-time error`, () => {
      const command = scripts[name];
      expect(command, `${name} is missing from package.json scripts`).toBeDefined();

      const run = spawnSync(`${command} ${args.join(" ")}`, {
        shell: true,
        cwd: process.cwd(),
        encoding: "utf8",
        env,
        timeout: 60_000,
      });

      const output = `${run.stdout ?? ""}${run.stderr ?? ""}`;
      // It reached its own code rather than dying on import: the probes print
      // either their info output or a validation message, so silence means it
      // never got that far.
      expect(output.trim(), `${name} produced no output`).not.toBe("");
      for (const signature of LOAD_FAILURES) {
        expect(output, `${name} failed to load:\n${output}`).not.toContain(signature);
      }
    }, 60_000);
  }
});
