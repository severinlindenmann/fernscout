import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEFAULT_MAX_AGE_HOURS, readBackupStatus, secondarySuccessStampPath } from "@/lib/backupStatus";

/**
 * "Are the backups working?", answered from off the machine.
 *
 * Nothing could answer it before B64. `systemctl list-timers` — the check both
 * the timer's own comment and the runbook recommended — reports the schedule
 * and never the result, so a backup that had aborted every night sat under a
 * perfectly healthy next-elapse. On the live server that ran three nights and
 * was noticed only because a person happened to be tailing the journal.
 *
 * The state machine matters more than it looks: `unknown` is the state of an
 * instance with no backup installed at all, which is what B65 turned out to be
 * for months, and it must not be reported as anything reassuring.
 */

let dir: string;
const HOUR = 3_600_000;

function stampSuccess(agoHours: number) {
  fs.writeFileSync(
    path.join(dir, ".backup-last-success"),
    `${new Date(Date.now() - agoHours * HOUR).toISOString()}\n`,
  );
}

function stampFailure(agoHours: number, detail = "fernscout-backup.service failed (result=exit-code)") {
  fs.writeFileSync(
    path.join(dir, ".backup-last-failure"),
    `${new Date(Date.now() - agoHours * HOUR).toISOString()}\n${detail}\n`,
  );
}

function stampSecondarySuccess(agoHours: number) {
  fs.writeFileSync(
    secondarySuccessStampPath(dir),
    `${new Date(Date.now() - agoHours * HOUR).toISOString()}\n`,
  );
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-backup-status-"));
  process.env.DATA_DIR = dir;
  delete process.env.BACKUP_MAX_AGE_HOURS;
});

afterEach(() => {
  delete process.env.DATA_DIR;
  delete process.env.BACKUP_MAX_AGE_HOURS;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("readBackupStatus", () => {
  test("no stamp at all is unknown, and says why", () => {
    const status = readBackupStatus();
    expect(status.state).toBe("unknown");
    expect(status.lastSuccessAt).toBeNull();
    expect(status.ageHours).toBeNull();
    expect(status.reason).toContain("no backup has ever recorded a success");
  });

  test("a recent success is ok, with its age", () => {
    stampSuccess(9);
    const status = readBackupStatus();
    expect(status.state).toBe("ok");
    expect(status.ageHours).toBeCloseTo(9, 1);
    expect(status.reason).toBeUndefined();
    expect(status.maxAgeHours).toBe(DEFAULT_MAX_AGE_HOURS);
  });

  test("a success older than the window is stale", () => {
    // Nightly: one missed run is still inside the window, two is not. That is
    // the whole sensitivity argument for the default.
    stampSuccess(25);
    expect(readBackupStatus().state).toBe("ok");
    stampSuccess(DEFAULT_MAX_AGE_HOURS + 1);
    const status = readBackupStatus();
    expect(status.state).toBe("stale");
    expect(status.reason).toContain(`${DEFAULT_MAX_AGE_HOURS}h`);
  });

  test("BACKUP_MAX_AGE_HOURS moves the window, and nonsense in it does not", () => {
    stampSuccess(50);
    process.env.BACKUP_MAX_AGE_HOURS = "168";
    expect(readBackupStatus().state).toBe("ok");
    process.env.BACKUP_MAX_AGE_HOURS = "not-a-number";
    expect(readBackupStatus().state).toBe("stale");
    expect(readBackupStatus().maxAgeHours).toBe(DEFAULT_MAX_AGE_HOURS);
  });

  test("a failure since the last success outranks the age check", () => {
    // The trap this avoids: "ok, because Tuesday worked" on a Friday where
    // every run since has failed.
    stampSuccess(2);
    stampFailure(1);
    const status = readBackupStatus();
    expect(status.state).toBe("failing");
    expect(status.lastFailure).toContain("fernscout-backup.service failed");
    expect(status.reason).toContain("the last one that finished was");
  });

  test("a failure older than the last success is history, not an alarm", () => {
    stampFailure(30);
    stampSuccess(4);
    const status = readBackupStatus();
    expect(status.state).toBe("ok");
    expect(status.lastFailureAt).not.toBeNull();
  });

  test("a failure with no success ever is failing, and says so plainly", () => {
    stampFailure(1);
    const status = readBackupStatus();
    expect(status.state).toBe("failing");
    expect(status.reason).toContain("none has ever succeeded here");
  });

  test("an unreadable or half-written stamp reads as no stamp, never throws", () => {
    // The stamp is written by shell, from a unit that can be killed mid-write.
    // A health endpoint that 500s because of a truncated file is a worse
    // outcome than one that says it does not know.
    fs.writeFileSync(path.join(dir, ".backup-last-success"), "");
    expect(readBackupStatus().state).toBe("unknown");
    fs.writeFileSync(path.join(dir, ".backup-last-success"), "not a date at all\n");
    expect(readBackupStatus().state).toBe("unknown");
  });

  // --- B659: the off-site copy's own, smaller state machine ---------------
  describe("secondary", () => {
    test("no secondary stamp at all is unknown — either unset, or never copied yet", () => {
      stampSuccess(1); // the primary can be perfectly healthy either way
      const status = readBackupStatus();
      expect(status.state).toBe("ok");
      expect(status.secondary.state).toBe("unknown");
      expect(status.secondary.lastSuccessAt).toBeNull();
      expect(status.secondary.reason).toContain("RESTIC_REPOSITORY_SECONDARY");
    });

    test("a recent secondary success is ok, independently of the primary's own age", () => {
      stampSuccess(1);
      stampSecondarySuccess(2);
      const status = readBackupStatus();
      expect(status.secondary.state).toBe("ok");
      expect(status.secondary.ageHours).toBeCloseTo(2, 1);
      expect(status.secondary.reason).toBeUndefined();
    });

    test("a stale secondary is stale without touching the primary's own state", () => {
      stampSuccess(1);
      stampSecondarySuccess(DEFAULT_MAX_AGE_HOURS + 5);
      const status = readBackupStatus();
      expect(status.state).toBe("ok");
      expect(status.secondary.state).toBe("stale");
      expect(status.secondary.reason).toContain(`${DEFAULT_MAX_AGE_HOURS}h`);
    });

    test("a failing primary never contaminates a healthy secondary, and vice versa", () => {
      stampSuccess(2);
      stampFailure(1);
      stampSecondarySuccess(3);
      const status = readBackupStatus();
      expect(status.state).toBe("failing"); // the primary alone decides this (B651)
      expect(status.secondary.state).toBe("ok");
    });
  });
});

describe("/api/health", () => {
  test("reports the backup block without changing the status code", async () => {
    // Deliberate: a stale backup must page an operator, not take the instance
    // out of a load balancer or fail `scripts/deploy.sh`.
    const { GET } = await import("@/app/api/health/route");
    stampSuccess(DEFAULT_MAX_AGE_HOURS + 10);

    // An anonymous probe, which is what an uptime monitor is (B234). `state`
    // is what it asserts on and stays public; `reason` is operator detail
    // since B1045 and needs `HEALTH_TOKEN` — see test/health-disclosure.test.ts.
    const res = await GET(new Request("https://example.test/api/health"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status: string;
      backup: { state: string; reason?: string; secondary: { state: string; reason?: string } };
    };
    expect(body.status).toBe("ok");
    expect(body.backup.state).toBe("stale");
    expect(body.backup.reason).toBeUndefined();
    // No RESTIC_REPOSITORY_SECONDARY configured here — B659's degrade-cleanly
    // case — reported as its own `unknown`, and never as a reason the top-level
    // status or the primary's own state changes.
    expect(body.backup.secondary.state).toBe("unknown");

    const withToken = process.env.HEALTH_TOKEN;
    process.env.HEALTH_TOKEN = "op-token";
    try {
      const opRes = await GET(
        new Request("https://example.test/api/health", {
          headers: { authorization: "Bearer op-token" },
        }),
      );
      const opBody = (await opRes.json()) as { backup: { reason?: string } };
      expect(opBody.backup.reason).toBeTruthy();
    } finally {
      if (withToken === undefined) delete process.env.HEALTH_TOKEN;
      else process.env.HEALTH_TOKEN = withToken;
    }
  });
});
