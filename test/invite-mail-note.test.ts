import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

/**
 * B407 — two refusals used to blame the server when a journal's own
 * `features.mail.enabled: false` was the actual reason nothing sent. Both the
 * redeem route's 503 and this note (`POST /api/v1/<user>/invites` with an
 * `email`) go through `mailDisabledReason`, which reads the same two checks
 * `sendMail` itself makes; this exercises the note in isolation, without the
 * whole invites route or an owner token.
 */

const JOURNAL = "ana";

let dir: string;

function serverConfig(mail: boolean) {
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "R", url: "https://example.test", defaultUser: JOURNAL },
      users: { reserved: [] },
      features: { mail: { enabled: mail, transport: "file" } },
    }),
  );
}

function journalConfig(mail: boolean | undefined) {
  fs.writeFileSync(
    path.join(dir, JOURNAL, "config.json"),
    JSON.stringify({
      title: "Ana's journal",
      tagline: "t",
      owner: { name: "A B", nickname: "A", email: "ana@example.test" },
      startLocation: "X",
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
      displayCurrencies: ["CHF"],
      units: "metric",
      ...(mail === undefined ? {} : { features: { mail: { enabled: mail } } }),
    }),
  );
}

async function reload() {
  const { clearConfigCache } = await import("@/lib/config");
  const { clearUserCache } = await import("@/lib/users");
  clearConfigCache();
  clearUserCache();
}

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-invite-note-"));
  process.env.CONTENT_DIR = dir;
  fs.mkdirSync(path.join(dir, JOURNAL, "trips"), { recursive: true });
});

afterAll(() => {
  delete process.env.CONTENT_DIR;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("mailFailedNote", () => {
  test("names the server when the server's own switch is off", async () => {
    serverConfig(false);
    journalConfig(undefined);
    await reload();

    const { mailFailedNote } = await import("@/lib/contacts/inviteMailNote");
    const note = mailFailedNote("reader@example.test", JOURNAL);
    expect(note).toContain("this server's mail is off");
    expect(note).not.toContain("journal");
  });

  /** The case B407 was filed over: the server can send, this journal said no. */
  test("names the journal, and points at PATCH /config, when only its own switch is off", async () => {
    serverConfig(true);
    journalConfig(false);
    await reload();

    const { mailFailedNote } = await import("@/lib/contacts/inviteMailNote");
    const note = mailFailedNote("reader@example.test", JOURNAL);
    expect(note).toContain("this journal's own mail is switched off");
    expect(note).toContain(`PATCH /api/v1/${JOURNAL}/config`);
    expect(note).not.toContain("this server's mail is off");
  });

  test("blames neither switch when both are on and the send still failed", async () => {
    serverConfig(true);
    journalConfig(undefined);
    await reload();

    const { mailFailedNote } = await import("@/lib/contacts/inviteMailNote");
    const note = mailFailedNote("reader@example.test", JOURNAL);
    expect(note).toContain("the mail failed to send");
    expect(note).not.toContain("server's mail is off");
    expect(note).not.toContain("journal's own mail is switched off");
  });
});
