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
 *     unit records a failure rather than a silent no-backup night;
 *   - and, since B64, the two things that make a failure *visible*: the
 *     `.backup-last-success` stamp `/api/health` reads, and `scripts/alert.sh`,
 *     which the unit's `OnFailure=` starts;
 *   - and, since B63, the repository probe: the two shapes of "no repository
 *     here" — *absent*, and *cannot see it* — must not be confused, because
 *     one may create a repository and the other must never be allowed to;
 *   - and, since B114, a `DATA_DIR` with something unreadable in it: the run
 *     stages what it can, names what it could not, and refuses to call that a
 *     success — one stray file may cost neither the night's backup nor the
 *     truth about it.
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
// B115. `timeout` is coreutils: on the VPS, and not on macOS without
// `brew install coreutils`. The script falls back to an unwrapped probe when
// it is missing, so the two branches are tested by two tests, each skipping
// where its branch cannot exist — the same shape as RESTIC and IS_ROOT above.
const HAS_TIMEOUT = haveBinary("timeout", ["--version"]) || haveBinary("gtimeout", ["--version"]);

if (!RESTIC) {
  // Not a failure — but not a pass either: the whole file is skipped, loudly,
  // rather than asserting nothing. `brew install restic` / `apt install restic`.
  console.warn("[test] restic is not installed — the backup.sh suite is being skipped entirely.");
}

type Run = { status: number; stdout: string; stderr: string };

/** Every file under `dir`, as relative path → sha256. Directories are implied
 * by the paths; a tree comparison that ignored contents would pass on an empty
 * restore, which is the exact failure this test exists to catch. */
function digestTree(dir: string, skip: (rel: string) => boolean = () => false): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (rel: string) => {
    for (const entry of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const child = rel === "" ? entry.name : path.join(rel, entry.name);
      if (skip(child)) continue;
      if (entry.isDirectory()) walk(child);
      else if (entry.isFile()) {
        out[child] = crypto.createHash("sha256").update(fs.readFileSync(path.join(dir, child))).digest("hex");
      }
    }
  };
  walk("");
  return out;
}

/** The B64 stamp files, which live in `DATA_DIR` and are therefore inside the
 * snapshot — but are written *after* it, so a snapshot always carries the
 * previous run's stamp and can never equal the live directory. That is correct
 * (a stamp written before the push would claim a backup that never happened),
 * and it is why the round-trip comparison skips them rather than chasing the
 * timestamps. */
const isStamp = (rel: string) => rel === ".backup-last-success" || rel === ".backup-last-failure";

describe.runIf(RESTIC)("scripts/backup.sh", () => {
  let scratch: string;
  let dataDir: string;
  let contentDir: string;
  let repo: string;
  let staging: string;
  let stubBin: string;

  const PASSWORD = "backup-drill-password";

  const successStamp = () => path.join(dataDir, ".backup-last-success");
  const failureStamp = () => path.join(dataDir, ".backup-last-failure");

  /** The stamp's ISO-8601 first line, or null when there is no stamp. */
  function readStamp(file: string): { at: string; detail?: string } | null {
    if (!fs.existsSync(file)) return null;
    const [first, ...rest] = fs.readFileSync(file, "utf8").split("\n");
    return { at: first.trim(), detail: rest.find((line) => line.trim() !== "")?.trim() };
  }

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

  /** A `restic` on PATH that fails the `cat config` probe with a chosen message
   * and exit 1 — which is what **every** restic before 0.17 does, whatever went
   * wrong. Debian 12 ships 0.14, so the message-reading fallback in the script
   * is not a legacy nicety; it is the only classifier a stock apt install gets.
   *
   * Only the probe is stubbed. Both classifications that matter here stop the
   * run at the probe, so nothing further is ever called. */
  function stubOldRestic(stderrText: string): Record<string, string> {
    fs.writeFileSync(
      path.join(stubBin, "restic"),
      `#!/bin/sh\nif [ "$1" = "cat" ]; then\n  echo '${stderrText}' >&2\n  exit 1\nfi\nexit 1\n`,
      { mode: 0o755 },
    );
    return { PATH: `${stubBin}${path.delimiter}${process.env.PATH ?? ""}` };
  }

  function clearResticStub() {
    fs.rmSync(path.join(stubBin, "restic"), { force: true });
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

    // Initialised by hand, once, before anything runs — which is exactly what
    // the runbook now tells an operator to do. Since B63 the script refuses to
    // create a repository it did not find, so a suite that relied on auto-init
    // would be testing a path the nightly timer can no longer take.
    expect(restic(["init"]).status, "the fixture repository must initialise").toBe(0);
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

      expect(digestTree(path.join(staged, "data"), isStamp)).toEqual(digestTree(dataDir, isStamp));
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
        // The path is readable, so restic can see there is nothing there:
        // absent, not unreachable. Since B63 that is refused by default rather
        // than initialised — and with the opt-in it still fails, because the
        // directory cannot be written.
        const run = runBackup({ RESTIC_REPOSITORY: path.join(locked, "repo"), BACKUP_INIT_IF_MISSING: "1" });
        expect(run.status).not.toBe(0);
        expect(run.stdout).toContain("creating a NEW, EMPTY repository");
        expect(run.stderr).toMatch(/permission denied/i);
        expect(fs.existsSync(path.join(locked, "repo"))).toBe(false);
      } finally {
        fs.chmodSync(locked, 0o700);
      }
    },
    180_000,
  );

  // --- B63: "not initialised yet" is not the same as "cannot see it" --------

  test(
    "a RESTIC_REPOSITORY that does not exist is refused, not quietly created",
    () => {
      // The whole of B63. A typo used to make a brand new empty repository,
      // back into it, prune it and exit 0 — a green backup protecting nothing,
      // while every real snapshot sat in the repository nobody wrote to again.
      const typo = path.join(scratch, "restic-repo-typo");
      const before = snapshotCount();

      const run = runBackup({ RESTIC_REPOSITORY: typo });

      expect(run.status, "a wrong repository must not be a successful backup").not.toBe(0);
      expect(run.stdout).toContain("there is no repository at");
      expect(run.stdout).toContain("refusing to create one");
      expect(run.stdout).not.toContain("backing up to");
      expect(fs.existsSync(typo), "nothing may be created at the wrong path").toBe(false);
      // And the repository that does hold the backups is untouched.
      expect(snapshotCount()).toBe(before);
    },
    180_000,
  );

  test(
    "the first run still works, by the route the runbook documents",
    () => {
      // The convenience is not gone, it is opt-in: one run with the flag, or
      // one `restic init` by hand. What is gone is the nightly timer being
      // able to do it without anybody asking.
      const fresh = path.join(scratch, "restic-repo-fresh");
      const run = runBackup({ RESTIC_REPOSITORY: fresh, BACKUP_INIT_IF_MISSING: "1" });

      expect(run.status, run.stdout + run.stderr).toBe(0);
      expect(run.stdout).toContain("creating a NEW, EMPTY repository");
      expect(run.stdout).toContain("nothing taken before now is in it");
      expect(snapshotCount(fresh)).toBe(1);

      // The count check: one snapshot in a repository somebody believes holds
      // a fortnight is worth saying out loud, even on the run that made it.
      expect(run.stdout).toContain("1 snapshot(s) tagged fernscout");
      expect(run.stdout).toMatch(/WARNING: one snapshot, in the repository this run just created/);
    },
    180_000,
  );

  test(
    "a healthy repository with a history draws no low-count warning",
    () => {
      const run = runBackup();
      expect(run.status).toBe(0);
      expect(run.stdout).toContain("repository is there and readable");
      expect(run.stdout).toMatch(/\d+ snapshot\(s\) tagged fernscout/);
      expect(run.stdout).not.toContain("not the repository you meant");
      expect(snapshotCount()).toBeGreaterThan(1);
    },
    180_000,
  );

  test.skipIf(IS_ROOT)(
    "a repository that cannot be read is never mistaken for one that is not there",
    () => {
      // The shape the restore drill actually hit on the live server: the repo
      // was root-owned, the service runs as `fernscout`, the old probe read
      // permission-denied as "not initialised yet", ran `restic init` and died
      // on "config file already exists".
      const unreadable = path.join(scratch, "restic-repo-unreadable");
      fs.cpSync(repo, unreadable, { recursive: true });
      fs.chmodSync(unreadable, 0o000);
      try {
        const run = runBackup({ RESTIC_REPOSITORY: unreadable });

        expect(run.status).not.toBe(0);
        expect(run.stdout).toContain("cannot read the repository");
        expect(run.stdout).toContain("no answer");
        // The two things that must not happen: init, and any claim of absence.
        expect(run.stdout).not.toContain("there is no repository at");
        expect(run.stdout).not.toContain("creating a NEW, EMPTY repository");
        expect(run.stdout).not.toContain("backing up to");
      } finally {
        fs.chmodSync(unreadable, 0o700);
      }
    },
    180_000,
  );

  test(
    "a wrong password is not mistaken for an absent repository either",
    () => {
      // Same class as the permission case, different cause: something is
      // there, and we cannot open it. Creating anything here would be wrong.
      const before = snapshotCount();
      const run = runBackup({ RESTIC_PASSWORD: "not-the-password" });

      expect(run.status).not.toBe(0);
      expect(run.stdout).toContain("cannot read the repository");
      expect(run.stdout).not.toContain("there is no repository at");
      expect(run.stdout).not.toContain("backing up to");
      expect(snapshotCount()).toBe(before);
    },
    180_000,
  );

  test(
    "an older restic, which returns 1 for everything, is classified by its message",
    () => {
      try {
        // Absent, as restic 0.14 phrases it.
        const absent = runBackup({
          ...stubOldRestic("Fatal: unable to open config file: stat /x/config: no such file or directory"),
        });
        expect(absent.status).not.toBe(0);
        expect(absent.stdout).toContain("there is no repository at");
        expect(absent.stdout).toContain("refusing to create one");

        // Unreadable, as restic 0.14 phrases it. Note the message contains
        // "unable to open config file" too — reading only that phrase is how a
        // naive fallback would send this down the absent path and init over a
        // repository that exists.
        const unreadable = runBackup({
          ...stubOldRestic("Fatal: unable to open config file: stat /x/config: permission denied"),
        });
        expect(unreadable.status).not.toBe(0);
        expect(unreadable.stdout).toContain("cannot read the repository");
        expect(unreadable.stdout).not.toContain("there is no repository at");

        // And an error nobody has a pattern for is treated as "cannot see it",
        // because absence has to be proven, not assumed.
        const strange = runBackup({ ...stubOldRestic("Fatal: something nobody has seen before") });
        expect(strange.status).not.toBe(0);
        expect(strange.stdout).toContain("cannot read the repository");
      } finally {
        clearResticStub();
      }
    },
    180_000,
  );

  // --- B64: a failed backup has to reach somebody ---------------------------

  test(
    "a run that finishes stamps DATA_DIR with the time /api/health reports",
    () => {
      fs.rmSync(successStamp(), { force: true });

      const run = runBackup();
      expect(run.status).toBe(0);

      const stamp = readStamp(successStamp());
      expect(stamp, "scripts/backup.sh must write .backup-last-success").not.toBeNull();
      // Parsed, not pattern-matched: lib/backupStatus.ts does `new Date(line)`
      // on it, and a stamp that string-matches but does not parse is worse
      // than none — it reads as "no backup has ever run".
      const at = new Date(stamp!.at);
      expect(Number.isNaN(at.getTime())).toBe(false);
      expect(Math.abs(Date.now() - at.getTime())).toBeLessThan(180_000);
      expect(run.stdout).toContain(".backup-last-success");
    },
    180_000,
  );

  test(
    "a run that fails leaves the last-success stamp alone",
    () => {
      // Otherwise the endpoint would report a backup that never happened,
      // which is worse than reporting none: it is the same lie the timer told.
      expect(runBackup().status).toBe(0);
      const before = readStamp(successStamp());
      expect(before).not.toBeNull();

      const failed = runBackup({
        DATABASE_URL: "postgres://fernscout@127.0.0.1:1/fernscout",
        ...stubPgDump("#!/bin/sh\necho 'pg_dump: error: connection refused' >&2\nexit 1\n"),
      });
      expect(failed.status).not.toBe(0);
      expect(readStamp(successStamp())?.at).toBe(before!.at);
    },
    180_000,
  );

  test(
    "the repository is announced before it is reached, so a stall is legible",
    () => {
      // B64: with an unreachable repository restic retries with exponential
      // backoff for minutes and the journal showed the staging lines, then
      // nothing at all. The fix is a line before the first call, not after it.
      const run = runBackup();
      const probe = run.stdout.indexOf("checking the repository at");
      const push = run.stdout.indexOf("backing up to");
      expect(probe, "the probe must announce itself").toBeGreaterThan(-1);
      expect(probe).toBeLessThan(push);
    },
    180_000,
  );

  // --- B115: an unreachable repository may not burn the whole unit timeout ---

  /**
   * `rest:http://127.0.0.1:1/` — a reserved port with nothing listening, the
   * fastest possible "unreachable". Without a bound, `restic cat config` was
   * measured still retrying after three minutes; the only limit was
   * TimeoutStartSec=30min, which is also how long the OnFailure= alert waited.
   */
  const UNREACHABLE = "rest:http://127.0.0.1:1/";

  test.skipIf(!HAS_TIMEOUT)(
    "an unreachable repository gives up within BACKUP_PROBE_TIMEOUT, not the unit timeout",
    () => {
      const started = Date.now();
      const run = runBackup({ RESTIC_REPOSITORY: UNREACHABLE, BACKUP_PROBE_TIMEOUT: "2" });
      const elapsed = (Date.now() - started) / 1000;

      expect(run.status, "an unreachable repository is not a successful backup").not.toBe(0);
      expect(run.stdout).toContain("cannot read the repository");
      // The point of the task: bounded, and by the value asked for. Generous
      // headroom over the 2s bound, because this also pays for staging the
      // fixture and starting restic — it is asserting "seconds, not minutes".
      expect(elapsed, `the probe took ${elapsed}s`).toBeLessThan(60);
      // It must never read as absent. `restic init` over a repository that is
      // merely slow to answer is the disaster the whole probe exists to stop.
      expect(run.stdout).not.toContain("creating a NEW, EMPTY repository");
    },
    120_000,
  );

  test.skipIf(HAS_TIMEOUT)(
    "with no timeout binary the probe still runs, and says it is unbounded",
    () => {
      // The macOS case. Making the script Linux-only would have been the other
      // legitimate answer, but it would stop this very suite running on the
      // machine the script is edited on.
      //
      // Deliberately against the *reachable* fixture repository. Pointing this
      // at UNREACHABLE would exercise the unbounded probe for real, which is
      // to say it would sit in restic's backoff for minutes — the defect
      // itself, inside the suite that is supposed to run quickly. What is
      // being asserted is that the fallback announces itself and does not
      // otherwise change the run.
      const run = runBackup();

      expect(run.status, "the fallback must not break an ordinary backup").toBe(0);
      expect(run.stdout).toContain("neither timeout nor gtimeout is installed");
      expect(run.stdout).toContain("checking the repository at");
    },
    180_000,
  );

  test(
    "scripts/alert.sh records the failure even where nothing else works",
    () => {
      // No systemctl, no journalctl, no app to mail from: a developer laptop,
      // and also a box where the alert's own mail path is broken. The stamp is
      // the channel that has no dependencies, so it is the one that must hold.
      fs.rmSync(failureStamp(), { force: true });
      const emptyApp = path.join(scratch, "no-app");
      fs.mkdirSync(emptyApp, { recursive: true });

      const run = spawnSync("bash", [path.join(process.cwd(), "scripts", "alert.sh"), "fernscout-backup.service"], {
        encoding: "utf8",
        env: { ...process.env, DATA_DIR: dataDir, APP_DIR: emptyApp },
      });

      expect(run.status, run.stdout + run.stderr).toBe(0);
      const stamp = readStamp(failureStamp());
      expect(stamp).not.toBeNull();
      expect(Number.isNaN(new Date(stamp!.at).getTime())).toBe(false);
      expect(stamp!.detail).toContain("fernscout-backup.service failed");
      expect(run.stdout).toContain(".backup-last-failure");
    },
    120_000,
  );

  test(
    "scripts/alert.sh writes no backup stamp for a unit that is not the backup",
    () => {
      fs.rmSync(failureStamp(), { force: true });
      const emptyApp = path.join(scratch, "no-app");
      fs.mkdirSync(emptyApp, { recursive: true });

      // The handler is generic — OnFailure= passes whatever unit failed. A
      // worker failure recorded as a backup failure would be a false alarm
      // about the one thing this whole mechanism exists to be trusted on.
      const run = spawnSync("bash", [path.join(process.cwd(), "scripts", "alert.sh"), "fernscout-worker.service"], {
        encoding: "utf8",
        env: { ...process.env, DATA_DIR: dataDir, APP_DIR: emptyApp },
      });

      expect(run.stdout).toContain("fernscout-worker.service failed");
      expect(fs.existsSync(failureStamp())).toBe(false);
      // Nothing could be recorded and nothing could be mailed, so the alarm
      // says so by failing itself — `systemctl --failed` is then the signal.
      expect(run.status).not.toBe(0);
    },
    120_000,
  );

  // --- B114: one file nobody needed may not cost the night's backup --------

  /** Snapshots carrying restic's `partial` tag — the label a run puts on a
   * snapshot it knows is missing paths. */
  function partialSnapshotCount(): number {
    const out = restic(["snapshots", "--tag", "partial", "--json"]);
    if (out.status !== 0) return 0;
    const parsed: unknown = JSON.parse(out.stdout || "[]");
    return Array.isArray(parsed) ? parsed.length : 0;
  }

  // chmod is advisory to root: as root every file reads, so the case cannot be
  // set up at all. Same guard, same reason, as the unwritable-repository test.
  test.skipIf(IS_ROOT)(
    "one unreadable file under DATA_DIR is named and skipped, not allowed to abort the run",
    () => {
      // A clean run first, so there is a success stamp for the partial run to
      // be caught leaving alone.
      expect(runBackup().status).toBe(0);
      const stampBefore = readStamp(successStamp());
      expect(stampBefore).not.toBeNull();
      // The shape found on the live server on 2026-09-01: a root-owned stray
      // an operator left in DATA_DIR. `cp -a` under `set -e` used to stop the
      // whole run here, before anything had been pushed.
      const stray = path.join(dataDir, "root-owned-stray.txt");
      fs.writeFileSync(stray, "left behind by an operator\n");
      fs.chmodSync(stray, 0o000);

      try {
        const run = runBackup();

        // 1. The night's backup still happens. This is the whole point: the
        //    journal's originals exist nowhere else, and losing them to a file
        //    nobody needed is the worse of the two failures.
        expect(run.stdout, "the snapshot must still be pushed").toContain("backing up to");
        expect(run.stdout, "and be labelled as incomplete").toContain("will be tagged 'partial'");
        expect(partialSnapshotCount()).toBeGreaterThan(0);

        // 2. The offending path is named. Before this it was not: the run died
        //    on cp's stderr and the journal never said which file.
        expect(run.stdout).toContain(stray);
        expect(run.stdout).toContain("1 path(s) under DATA_DIR could not be staged");

        // 3. And it is not a success. Skipping is tolerated, being told it was
        //    fine is not: non-zero exit so the unit's OnFailure= alert fires,
        //    and the stamp /api/health reads stays at the last real success.
        expect(run.status).not.toBe(0);
        expect(run.stdout).toContain("path(s) are missing from it");
        expect(readStamp(successStamp())?.at).toBe(stampBefore!.at);

        // 4. Everything readable is in that snapshot — a partial backup that
        //    quietly dropped its neighbours would be no better than none.
        const staged = restoreLatest("partial");
        expect(fs.existsSync(path.join(staged, "data", "reactions.json"))).toBe(true);
        expect(fs.existsSync(path.join(staged, "data", "fernscout.db"))).toBe(true);
        expect(fs.existsSync(path.join(staged, "data", "root-owned-stray.txt"))).toBe(false);
        expect(
          fs.existsSync(path.join(staged, "content", "alex", "trips", "kyrgyzstan-2026", "originals", "DSCF1234.RAF")),
        ).toBe(true);
      } finally {
        fs.chmodSync(stray, 0o600);
        fs.rmSync(stray, { force: true });
      }
    },
    180_000,
  );

  test.skipIf(IS_ROOT)(
    "an unreadable directory is named too, rather than staged as an empty one",
    () => {
      // The case a tree comparison alone cannot see: `cp` creates the
      // directory at the destination and only then fails to read it, so both
      // trees contain it and nothing looks wrong. What is inside it is not
      // merely missing, it cannot even be enumerated — so the run says so.
      const locked = path.join(dataDir, "locked-subdir");
      fs.mkdirSync(locked, { recursive: true });
      fs.writeFileSync(path.join(locked, "inside.json"), "{}");
      fs.chmodSync(locked, 0o000);

      try {
        const run = runBackup();

        expect(run.status).not.toBe(0);
        expect(run.stdout).toContain(locked);
        expect(run.stdout).toContain("its contents could not even be listed");
        expect(run.stdout).toContain("backing up to");

        // The snapshot holds the empty directory and not its contents, which
        // is exactly why the warning has to exist.
        const listed = restic(["ls", "latest"]);
        expect(listed.status).toBe(0);
        expect(listed.stdout).toContain("/data/locked-subdir");
        expect(listed.stdout).not.toContain("locked-subdir/inside.json");
      } finally {
        fs.chmodSync(locked, 0o700);
        fs.rmSync(locked, { recursive: true, force: true });
      }
    },
    180_000,
  );

  test.skipIf(IS_ROOT)(
    "fixing the permissions makes the next run a clean success again",
    () => {
      // The state is not sticky: nothing is remembered between runs, so the
      // operator's fix shows up as a green run and a fresh stamp the same
      // night, with no `partial` tag on the new snapshot.
      fs.rmSync(successStamp(), { force: true });

      const run = runBackup();

      expect(run.status, run.stdout + run.stderr).toBe(0);
      expect(run.stdout).not.toContain("could not be staged");
      expect(run.stdout).not.toContain("path(s) are missing from it");
      expect(run.stdout).not.toContain("will be tagged 'partial'");
      expect(readStamp(successStamp())).not.toBeNull();
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
