import { afterAll, beforeAll, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

/**
 * `npm run status` — the body of the nightly success mail (B464).
 *
 * Run for real against a content folder on disk, because the whole claim this
 * script makes is that its numbers are the ones the site would render. A test
 * that stubbed the readers would prove only that the formatter runs.
 *
 * The property that matters most is not any single count: it is that a section
 * which cannot be read **says so**, and that nothing here can exit non-zero.
 * This runs after a backup that already succeeded, and a status block is never
 * a reason for the mail not to go out.
 */

const NODE_BIN = process.execPath;

let scratch: string;
let contentDir: string;

function writeJournal(username: string, opts: { listed?: boolean; trips?: number; drafts?: number } = {}) {
  const dir = path.join(contentDir, username);
  fs.mkdirSync(path.join(dir, "trips"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      title: `${username}'s journal`,
      tagline: "t",
      owner: { name: "Kim", nickname: "Kim", email: `${username}@example.test` },
      startLocation: "Zurich, Switzerland",
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
      displayCurrencies: ["CHF"],
      units: "metric",
      features: {},
      ...(opts.listed === false ? { visibility: "guest" } : {}),
    }),
  );
  for (let t = 0; t < (opts.trips ?? 1); t++) {
    const trip = path.join(dir, "trips", `trip-${t}`);
    fs.mkdirSync(path.join(trip, "entries"), { recursive: true });
    fs.writeFileSync(
      path.join(trip, "trip.md"),
      `---\nid: trip-${t}\ntitle: "Trip ${t}"\nstart: "2026-06-01"\nend: "2026-06-10"\nstatus: past\nvisibility: public\n---\n\nIntro.\n`,
    );
    fs.writeFileSync(
      path.join(trip, "entries", "2026-06-01-one.md"),
      "---\ndate: 2026-06-01\ntitle: One\n---\n\nA published day.\n",
    );
    for (let d = 0; d < (opts.drafts ?? 0); d++) {
      fs.writeFileSync(
        path.join(trip, "entries", `2026-06-0${d + 2}-draft.md`),
        `---\ndate: 2026-06-0${d + 2}\ntitle: Draft\nstatus: draft\n---\n\nNot published.\n`,
      );
    }
  }
}

function runStatus(extra: string[] = [], env: Record<string, string> = {}) {
  const result = spawnSync(
    NODE_BIN,
    [
      path.join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs"),
      "--conditions=react-server",
      path.join(process.cwd(), "scripts", "status.mts"),
      ...extra,
    ],
    { encoding: "utf8", env: { ...process.env, CONTENT_DIR: contentDir, DATABASE_URL: "", ...env } },
  );
  return { status: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

beforeAll(() => {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-status-"));
  contentDir = path.join(scratch, "content");
  fs.mkdirSync(contentDir, { recursive: true });
  fs.writeFileSync(
    path.join(contentDir, "config.json"),
    JSON.stringify({
      configVersion: 1,
      site: { name: "Testbed", url: "https://example.test", defaultUser: "keeper" },
      users: { reserved: [] },
      features: {},
    }),
  );
  writeJournal("keeper", { trips: 2, drafts: 1 });
  writeJournal("quiet", { trips: 1, listed: false });
});

afterAll(() => {
  if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
});

describe("npm run status", () => {
  test("counts journals, trips, days and drafts the way the site does", () => {
    const run = runStatus();
    expect(run.status, run.stdout + run.stderr).toBe(0);

    // Three trips over two journals, one published day each, and the one draft
    // that must not be counted as published — the distinction the whole
    // draft-by-default rule rests on (AGENTS.md).
    expect(run.stdout).toContain("Testbed — 2 journals, 3 trips, 3 days published");
    expect(run.stdout).toContain("2 days still in draft");
    expect(run.stdout).toContain("1 of 2 journals listed");
    expect(run.stdout).toContain("keeper");
    expect(run.stdout).toContain("unlisted");
  });

  test("says the database is absent rather than reporting zero guests", () => {
    // A zero here would be a claim — "nobody is reading this journal" — and on
    // the prototype tier, which is the default, it would be a false one.
    const run = runStatus();
    expect(run.status).toBe(0);
    expect(run.stdout).toContain("no database on this instance");
    expect(run.stdout).not.toContain("guests with a live grant");
  });

  test("a journal it cannot read is named, and does not take the report down", () => {
    // The property the nightly mail depends on. One broken config.json must
    // not turn a status report into no mail at all.
    const broken = path.join(contentDir, "broken");
    fs.mkdirSync(path.join(broken, "trips"), { recursive: true });
    fs.writeFileSync(path.join(broken, "config.json"), "{ this is not json");
    try {
      const run = runStatus();
      expect(run.status, "a status report may never fail the mail that carries it").toBe(0);
      expect(run.stdout).toContain("could not be read");
      expect(run.stdout).toContain("journal broken: config.json could not be read");
      // And the journals that are fine are still reported.
      expect(run.stdout).toContain("keeper");
    } finally {
      fs.rmSync(broken, { recursive: true, force: true });
    }
  });

  test("--json carries the same numbers for anything that wants to read them", () => {
    const run = runStatus(["--json"]);
    expect(run.status, run.stdout + run.stderr).toBe(0);
    const parsed = JSON.parse(run.stdout);
    expect(parsed.site).toBe("Testbed");
    expect(parsed.journals).toHaveLength(2);
    const keeper = parsed.journals.find((j: { username: string }) => j.username === "keeper");
    expect(keeper.trips).toBe(2);
    expect(keeper.days).toBe(2);
    expect(keeper.drafts).toBe(2);
    expect(keeper.bytes).toBeGreaterThan(0);
  });
});
