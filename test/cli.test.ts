import { describe, expect, test } from "vitest";
import { execFile } from "node:child_process";
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

/** Scripts that read content through `lib/`, and so need the condition. */
const CONTENT_READING = ["export", "photobook", "db:migrate", "db:status", "db:import"];

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
