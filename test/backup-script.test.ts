import { beforeAll, afterAll, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { postgresConfigured } from "./support/dialects";

/**
 * `scripts/backup.sh`, exercised end to end against a **local filesystem
 * restic repository** — no network, no cloud account, no VPS.
 *
 * This is the automatable half of B21. What it covers:
 *
 *   - staging `DATA_DIR` and `content/`, pushing a snapshot, and restoring it
 *     into a scratch directory byte-for-byte (including a file that exists in
 *     neither git nor the journal export: an `originals/` photograph);
 *   - the restore path the runbook actually documents — the snapshot keeps the
 *     staging directory's absolute path, so `docs/archiv/runbook.md` step 2
 *     locates it by name;
 *   - the failure paths: a `pg_dump` that fails must abort *without* pushing a
 *     snapshot, and an unwritable repository must exit non-zero so the systemd
 *     unit records a failure rather than a silent no-backup night.
 *
 * What it deliberately does **not** cover, and cannot: the destroy-and-restore
 * drill against the deployed stack. Restoring here means "the files come back
 * out of restic", not "the service came back up". B21 items 1 and 2 stay open
 * for a person.
 *
 * `pg_dump` is stubbed on PATH for the branch tests — that proves the script's
 * plumbing, not Postgres. The one test that wants a real database is behind
 * `POSTGRES_TEST_URL`, the same guard the db suites use.
 */

const BACKUP_SH = path.join(process.cwd(), "scripts", "backup.sh");

function haveBinary(bin: string, args: string[] = ["--version"]): boolean {
  return spawnSync(bin, args, { stdio: "ignore" }).status === 0;
}

const RESTIC = haveBinary("restic", ["version"]);
const PG_DUMP = haveBinary("pg_dump");
const IS_ROOT = typeof process.getuid === "function" && process.getuid() === 0;

if (!RESTIC) {
  // Not a failure — but not a pass either: the whole file is skipped, loudly,
  // rather than asserting nothing. `brew install restic` / `apt install restic`.
  console.warn("[test] restic is not installed — the backup.sh suite is being skipped entirely.");
}

type Run = { status: number; stdout: string; stderr: string };

/** Every file under `dir`, as relative path → sha256. Directories are implied
 * by the paths; a tree comparison that ignored contents would pass on an empty
 * restore, which is the exact failure this test exists to catch. */
function digestTree(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (rel: string) => {
    for (const entry of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const child = rel === "" ? entry.name : path.join(rel, entry.name);
      if (entry.isDirectory()) walk(child);
      else if (entry.isFile()) {
        out[child] = crypto.createHash("sha256").update(fs.readFileSync(path.join(dir, child))).digest("hex");
      }
    }
  };
  walk("");
  return out;
}

describe.runIf(RESTIC)("scripts/backup.sh", () => {
  let scratch: string;
  let dataDir: string;
  let contentDir: string;
  let repo: string;
  let staging: string;
  let stubBin: string;

  const PASSWORD = "backup-drill-password";

  function runBackup(extra: Record<string, string> = {}): Run {
    // A DATABASE_URL inherited from the developer's shell would send the
    // script down the Postgres branch in tests that are not about it.
    const inherited: NodeJS.ProcessEnv = { ...process.env };
    delete inherited.DATABASE_URL;
    const env: NodeJS.ProcessEnv = {
      ...inherited,
      DATA_DIR: dataDir,
      CONTENT_DIR: contentDir,
      RESTIC_REPOSITORY: repo,
      RESTIC_PASSWORD: PASSWORD,
      BACKUP_STAGING_DIR: staging,
      ...extra,
    };
    const result = spawnSync("bash", [BACKUP_SH], { encoding: "utf8", env });
    return { status: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
  }

  function restic(args: string[], repository = repo): Run {
    const result = spawnSync("restic", args, {
      encoding: "utf8",
      env: { ...process.env, RESTIC_REPOSITORY: repository, RESTIC_PASSWORD: PASSWORD },
    });
    return { status: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
  }

  function snapshotCount(repository = repo): number {
    const out = restic(["snapshots", "--json"], repository);
    if (out.status !== 0) return 0;
    const parsed: unknown = JSON.parse(out.stdout || "[]");
    return Array.isArray(parsed) ? parsed.length : 0;
  }

  /** Restore the newest snapshot and return the staged tree inside it, found
   * the way `docs/archiv/runbook.md` step 2 finds it: by directory name. */
  function restoreLatest(label: string): string {
    const target = path.join(scratch, `restore-${label}`);
    fs.mkdirSync(target, { recursive: true });
    const out = restic(["restore", "latest", "--target", target]);
    expect(out.stderr + out.stdout).toContain("Restored");
    expect(out.status).toBe(0);

    let staged = "";
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        if (entry.name === "fernscout-backup-staging") staged = path.join(dir, entry.name);
        else walk(path.join(dir, entry.name));
      }
    };
    walk(target);
    expect(staged, "the runbook locates the staged tree by directory name").not.toBe("");
    return staged;
  }

  /** A `pg_dump` on PATH that behaves as told, so the branch can be exercised
   * on a laptop with no Postgres at all. */
  function stubPgDump(body: string): Record<string, string> {
    fs.writeFileSync(path.join(stubBin, "pg_dump"), body, { mode: 0o755 });
    return { PATH: `${stubBin}${path.delimiter}${process.env.PATH ?? ""}` };
  }

  beforeAll(() => {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-backup-"));
    dataDir = path.join(scratch, "data");
    contentDir = path.join(scratch, "content");
    repo = path.join(scratch, "restic-repo");
    // Named exactly as the deployed staging directory is, so the runbook's
    // `find /restore -type d -name 'fernscout-backup-staging'` is under test
    // too and not just assumed.
    staging = path.join(scratch, "fernscout-backup-staging");
    stubBin = path.join(scratch, "bin");
    fs.mkdirSync(stubBin, { recursive: true });

    // DATA_DIR: what the app writes — reaction state, a push subscription, and
    // the SQLite file, which is binary and must survive as bytes.
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(
      path.join(dataDir, "reactions.json"),
      JSON.stringify({ "alex/kyrgyzstan-2026": { "2026-06-01-over-the-pass": { heart: 7 } } }),
    );
    fs.writeFileSync(
      path.join(dataDir, "push-subscriptions.json"),
      JSON.stringify([{ endpoint: "https://example.invalid/push/abc", keys: { p256dh: "k", auth: "a" } }]),
    );
    fs.writeFileSync(path.join(dataDir, "fernscout.db"), crypto.randomBytes(4096));

    // content/: an uncommitted edit, and an original that is in neither git nor
    // the export — the two things "just re-clone the repo" would silently lose.
    const trip = path.join(contentDir, "alex", "trips", "kyrgyzstan-2026");
    fs.mkdirSync(path.join(trip, "entries"), { recursive: true });
    fs.mkdirSync(path.join(trip, "originals"), { recursive: true });
    fs.writeFileSync(path.join(trip, "trip.md"), "---\ntitle: Kyrgyzstan\n---\n\nedited on the box, never committed\n");
    fs.writeFileSync(path.join(trip, "entries", "2026-06-01-over-the-pass.md"), "---\ndate: 2026-06-01\n---\n\nUp early.\n");
    fs.writeFileSync(path.join(trip, "originals", "DSCF1234.RAF"), crypto.randomBytes(64 * 1024));
  });

  afterAll(() => {
    if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
  });

  test(
    "backs up DATA_DIR and content/, and restores them byte-identical",
    () => {
      const run = runBackup();
      expect(run.stderr + run.stdout).toContain("done");
      expect(run.status).toBe(0);
      expect(snapshotCount()).toBe(1);

      const staged = restoreLatest("roundtrip");

      expect(digestTree(path.join(staged, "data"))).toEqual(digestTree(dataDir));
      expect(digestTree(path.join(staged, "content"))).toEqual(digestTree(contentDir));

      // Named explicitly, because these are the acceptance criteria in B21 and
      // an equality assertion over a tree is easy to satisfy with two empty
      // trees if the seeding above ever breaks.
      const trip = path.join("alex", "trips", "kyrgyzstan-2026");
      const restoredContent = path.join(staged, "content");
      expect(fs.readFileSync(path.join(restoredContent, trip, "trip.md"), "utf8")).toContain(
        "edited on the box, never committed",
      );
      expect(fs.readFileSync(path.join(restoredContent, trip, "originals", "DSCF1234.RAF"))).toEqual(
        fs.readFileSync(path.join(contentDir, trip, "originals", "DSCF1234.RAF")),
      );
      expect(JSON.parse(fs.readFileSync(path.join(staged, "data", "reactions.json"), "utf8"))).toEqual({
        "alex/kyrgyzstan-2026": { "2026-06-01-over-the-pass": { heart: 7 } },
      });

      // The staging directory is scratch, not state: the script's EXIT trap
      // clears it, or the next run's `rm -rf` would be doing it blind.
      expect(fs.existsSync(staging)).toBe(false);
    },
    180_000,
  );

  test(
    "no DATABASE_URL is not a failure — the prototype tier has no database",
    () => {
      const run = runBackup();
      expect(run.status).toBe(0);
      expect(run.stdout).toContain("skipping DB dump");
    },
    180_000,
  );

  test(
    "a pg_dump that fails aborts, and pushes no snapshot at all",
    () => {
      // "no new snapshot" proves nothing against an empty repository, so make
      // sure there is one to fail to add to — whichever order the file runs in.
      if (snapshotCount() === 0) expect(runBackup().status).toBe(0);
      const before = snapshotCount();
      expect(before).toBeGreaterThan(0);

      const run = runBackup({
        DATABASE_URL: "postgres://fernscout@127.0.0.1:1/fernscout",
        ...stubPgDump("#!/bin/sh\necho 'pg_dump: error: connection refused' >&2\nexit 1\n"),
      });

      expect(run.status).not.toBe(0);
      expect(run.stdout).toContain("aborting before pushing a backup without a DB dump");
      expect(run.stdout).not.toContain("backing up to");
      expect(snapshotCount()).toBe(before);
    },
    180_000,
  );

  test(
    "a pg_dump that succeeds lands in the snapshot as db/postgres.dump",
    () => {
      const run = runBackup({
        DATABASE_URL: "postgres://fernscout@127.0.0.1:5432/fernscout",
        ...stubPgDump("#!/bin/sh\nprintf 'PGDMP-stub-dump'\n"),
      });
      expect(run.status).toBe(0);
      expect(run.stdout).toContain("dumping Postgres with the local pg_dump");

      const staged = restoreLatest("withdump");
      expect(fs.readFileSync(path.join(staged, "db", "postgres.dump"), "utf8")).toBe("PGDMP-stub-dump");
    },
    180_000,
  );

  // chmod is advisory to root, so the unwritable-repository case would pass
  // vacuously there — the same reason migrate-owner.test.ts skips its
  // permission case.
  test.skipIf(IS_ROOT)(
    "an unwritable restic repository exits non-zero, so systemd records a failure",
    () => {
      const locked = path.join(scratch, "locked");
      fs.mkdirSync(locked, { recursive: true });
      fs.chmodSync(locked, 0o500);
      try {
        const run = runBackup({ RESTIC_REPOSITORY: path.join(locked, "repo") });
        expect(run.status).not.toBe(0);
        expect(run.stdout).toContain("running 'restic init'");
        expect(run.stderr).toMatch(/permission denied/i);
        expect(fs.existsSync(path.join(locked, "repo"))).toBe(false);
      } finally {
        fs.chmodSync(locked, 0o700);
      }
    },
    180_000,
  );

  // The real database, behind the guard the other db suites use. Everything
  // above proves the script's branches; this proves the dump it takes is one
  // `pg_restore` will actually read.
  const realPg = postgresConfigured() && PG_DUMP && haveBinary("pg_restore");
  test.runIf(realPg)(
    "the dump taken from a real Postgres is one pg_restore can list",
    () => {
      const url = process.env.POSTGRES_TEST_URL ?? "";
      const run = runBackup({ DATABASE_URL: url });
      expect(run.status).toBe(0);

      const staged = restoreLatest("realpg");
      const dump = path.join(staged, "db", "postgres.dump");
      expect(fs.statSync(dump).size).toBeGreaterThan(0);
      const listed = spawnSync("pg_restore", ["-l", dump], { encoding: "utf8" });
      expect(listed.status).toBe(0);
      expect(listed.stdout).toContain("Archive created at");
    },
    180_000,
  );
});
