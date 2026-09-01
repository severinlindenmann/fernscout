import { afterAll, beforeAll, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

/**
 * `npm run alert` — the mail half of B64.
 *
 * `scripts/alert.sh` is started by `OnFailure=` on the backup unit and has two
 * channels: a stamp file (covered in `backup-script.test.ts`, because it must
 * work with nothing installed) and this, which is the only one that reaches a
 * person who is not already looking at the box.
 *
 * Run for real, against the file transport, so "somebody is told" is a message
 * on disk rather than a claim. No mail account, no network: `lib/mail` writes
 * `.eml` files, which is exactly what that transport exists for.
 */

const NODE_BIN = process.execPath;

let scratch: string;
let contentDir: string;

function writeContent(mailEnabled: boolean, ownerEmail: string | null) {
  fs.rmSync(contentDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(contentDir, "keeper", "trips"), { recursive: true });
  fs.writeFileSync(
    path.join(contentDir, "config.json"),
    JSON.stringify({
      configVersion: 1,
      site: { name: "Testbed", url: "https://example.test", defaultUser: "keeper" },
      users: { reserved: [] },
      features: { mail: { enabled: mailEnabled, transport: "file" } },
    }),
  );
  fs.writeFileSync(
    path.join(contentDir, "keeper", "config.json"),
    JSON.stringify({
      title: "Keeper's journal",
      tagline: "t",
      owner: ownerEmail
        ? { name: "Kim Keeper", nickname: "Kim", email: ownerEmail }
        : { name: "Kim Keeper", nickname: "Kim" },
      startLocation: "Zurich, Switzerland",
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
      displayCurrencies: ["CHF"],
      units: "metric",
      features: {},
    }),
  );
}

function runAlert(extra: string[] = [], env: Record<string, string> = {}) {
  const result = spawnSync(
    NODE_BIN,
    [
      path.join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs"),
      "--conditions=react-server",
      path.join(process.cwd(), "scripts", "alert.mts"),
      "--unit",
      "fernscout-backup.service",
      ...extra,
    ],
    {
      encoding: "utf8",
      input: "Job for fernscout-backup.service failed because the control process exited with error code.\n",
      env: { ...process.env, CONTENT_DIR: contentDir, BACKUP_ALERT_EMAIL: "", ...env },
    },
  );
  return { status: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

/** The `.eml` with its base64 parts decoded — `lib/mail/rfc822.ts` encodes
 * every body, so asserting on the raw file would only prove it is base64. */
function readMail(file: string): string {
  const raw = fs.readFileSync(file, "utf8");
  return raw.replace(/(?:^[A-Za-z0-9+/=]{60,}$\n?)+/gm, (block) =>
    Buffer.from(block.replace(/\s+/g, ""), "base64").toString("utf8"),
  );
}

function mailFiles(user = "keeper"): string[] {
  const dir = path.join(contentDir, user, "mail");
  return fs.existsSync(dir) ? fs.readdirSync(dir) : [];
}

beforeAll(() => {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-alert-"));
  contentDir = path.join(scratch, "content");
});

afterAll(() => {
  if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
});

describe("npm run alert", () => {
  test(
    "mails the journal owner, with the unit and what to look at",
    () => {
      writeContent(true, "ops@example.test");
      const run = runAlert();
      expect(run.status, run.stdout + run.stderr).toBe(0);

      const files = mailFiles();
      expect(files, "the alert must produce an actual message").toHaveLength(1);
      const eml = readMail(path.join(contentDir, "keeper", "mail", files[0]));
      expect(eml).toContain("ops@example.test");
      expect(eml).toContain("fernscout-backup.service failed");
      // The detail the caller piped in, and the two commands that answer the
      // question the reader will have next.
      expect(eml).toContain("control process exited with error code");
      expect(eml).toContain("systemctl status fernscout-backup.service");
      expect(eml).toContain("/api/health");
    },
    120_000,
  );

  test(
    "BACKUP_ALERT_EMAIL wins over the journal owner",
    () => {
      writeContent(true, "ops@example.test");
      const run = runAlert([], { BACKUP_ALERT_EMAIL: "oncall@example.test" });
      expect(run.status, run.stdout + run.stderr).toBe(0);
      const files = mailFiles();
      const eml = readMail(path.join(contentDir, "keeper", "mail", files.at(-1)!));
      expect(eml).toContain("oncall@example.test");
    },
    120_000,
  );

  test(
    "mail switched off exits 3 and says what still knows",
    () => {
      // Mail is off by default on every instance, so this is the ordinary
      // case. It must not read as the alert being broken, and it must not
      // pretend somebody was told.
      writeContent(false, "ops@example.test");
      const run = runAlert();
      expect(run.status).toBe(3);
      expect(run.stderr).toContain("mail is switched off");
      expect(run.stderr).toContain("/api/health");
      expect(mailFiles()).toHaveLength(0);
    },
    120_000,
  );

  test(
    "nobody to tell is an error, not a silent success",
    () => {
      writeContent(true, null);
      const run = runAlert();
      expect(run.status).toBe(1);
      expect(run.stderr).toContain("BACKUP_ALERT_EMAIL");
      expect(mailFiles()).toHaveLength(0);
    },
    120_000,
  );

  test(
    "--dry-run prints the message and sends nothing",
    () => {
      writeContent(true, "ops@example.test");
      const run = runAlert(["--dry-run"]);
      expect(run.status, run.stdout + run.stderr).toBe(0);
      expect(run.stdout).toContain("would send to ops@example.test");
      expect(mailFiles()).toHaveLength(0);
    },
    120_000,
  );
});
