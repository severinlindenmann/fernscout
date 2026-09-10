import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { firstQuestions } from "@/lib/api/agentCopy";
import { clearConfigCache } from "@/lib/config";
import { closeDatabase } from "@/lib/db";
import { clearUserCache } from "@/lib/users";
import { journalForNumber } from "@/lib/registry";
import { handleInboundMessage } from "@/lib/whatsapp/dispatch";
import type { InboundMessage } from "@/lib/whatsapp/inbound";

/**
 * B1363 — a stranger makes a journal without leaving WhatsApp.
 *
 * The whole flow is driven here rather than one stage at a time, because the
 * thing that was broken was never one stage: it was that there was no road.
 * Both halves of the outcome are checked — the journal on disk *and* the tel
 * registry naming it, since the second is what makes the next message an
 * owner's message rather than another stranger's.
 */

let dir: string;
const TEL = "41760004242";

/**
 * Every reply, in the order it was sent.
 *
 * The dry-run backend files a reply under the journal it belongs to, and a
 * stranger's has none — so this reads the journal-less folder *and* any
 * journal folder, which is what lets one assertion span the moment a stranger
 * becomes an owner. The filenames lead with a UTC instant, so sorting them
 * together is sorting by time.
 */
function replies(): { body: string; buttons?: { title: string }[] }[] {
  const found: { file: string; body: unknown }[] = [];
  for (const owner of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!owner.isDirectory()) continue;
    const replyDir = path.join(dir, owner.name, "whatsapp-replies");
    if (!fs.existsSync(replyDir)) continue;
    for (const file of fs.readdirSync(replyDir)) {
      found.push({ file, body: JSON.parse(fs.readFileSync(path.join(replyDir, file), "utf8")) });
    }
  }
  return found
    .sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0))
    .map((one) => one.body as { body: string; buttons?: { title: string }[] });
}

function lastReply(): string {
  const all = replies();
  return all.length === 0 ? "" : all[all.length - 1].body;
}

async function say(body: string): Promise<void> {
  await handleInboundMessage({
    kind: "text",
    id: `wamid.${Math.random().toString(36).slice(2)}`,
    from: TEL,
    timestamp: "1710000000",
    body,
  } satisfies InboundMessage);
}

async function tap(replyId: string, title: string): Promise<void> {
  await handleInboundMessage({
    kind: "interactive",
    id: `wamid.${Math.random().toString(36).slice(2)}`,
    from: TEL,
    timestamp: "1710000000",
    replyId,
    title,
  } satisfies InboundMessage);
}

/** The code the flow just mailed, read out of the `.eml` the file transport
 *  wrote — the same place a person reads it, and the only honest way to drive
 *  this end to end. The letter's parts are base64, so they are decoded rather
 *  than scanned as text. */
function mailedCode(): string {
  const mailDir = path.join(dir, "mail", ".mail");
  const files = fs.existsSync(mailDir) ? fs.readdirSync(mailDir).sort() : [];
  expect(files.length).toBeGreaterThan(0);
  const raw = fs.readFileSync(path.join(mailDir, files[files.length - 1]), "utf8");
  const decoded = raw
    .split(/--fs-[a-z0-9-]+/)
    .map((part) => {
      const body = part.split(/\r?\n\r?\n/).slice(1).join("\n").replace(/\s+/g, "");
      try {
        return Buffer.from(body, "base64").toString("utf8");
      } catch {
        return "";
      }
    })
    .join("\n");
  const match = decoded.match(/\b(\d{6})\b/);
  expect(match).not.toBeNull();
  return match![1];
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-wa-onboarding-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATA_DIR = dir;
  process.env.SESSION_SECRET = "test-secret-for-onboarding";
  process.env.WHATSAPP_APP_SECRET = "test-secret";
  process.env.WHATSAPP_VERIFY_TOKEN = "test-token";
  // A database per test, so a code minted in one is never live in the next.
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "onboarding.db")}`;
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "Fernscout Test", url: "https://t.test" },
      users: { reserved: [] },
      features: {
        whatsappInbound: { enabled: true },
        whatsapp: { enabled: true, backend: "dry-run", number: "41790000000" },
        signup: { enabled: true },
        auth: { enabled: true },
        mail: { enabled: true, transport: "file" },
      },
    }),
  );
  clearConfigCache();
  clearUserCache();
});

afterEach(async () => {
  await closeDatabase();
  for (const key of ["CONTENT_DIR", "DATA_DIR", "SESSION_SECRET", "DATABASE_URL", "WHATSAPP_APP_SECRET", "WHATSAPP_VERIFY_TOKEN"]) delete process.env[key];
  clearConfigCache();
  clearUserCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("onboarding a stranger over WhatsApp", () => {
  test("nine answers make a journal, and the number owns it afterwards", async () => {
    await say("Hallo");
    // The first message is the only one not in the person's own language: it
    // cannot be, since which that is has not been asked yet.
    expect(replies()[0].body).toMatch(/Choose a language/);
    expect(replies()[0].buttons?.map((b) => b.title)).toEqual(["English", "Deutsch", "Magyar"]);

    await tap("onb:lang:de", "Deutsch");
    expect(lastReply()).toMatch(/E-Mail-Adresse/);
    // The disclosure rides on the same message, in code and in German.
    expect(lastReply()).toMatch(/Ich bin kein Mensch/);
    expect(lastReply()).toMatch(/WhatsApp \(Meta\)/);

    await say("neu@example.test");
    expect(lastReply()).toMatch(/sechsstelligen Code an neu@example\.test/);

    await say(mailedCode());
    expect(lastReply()).toMatch(/Wie soll das Journal hei/);

    await say("Unsere Reisen");
    expect(lastReply()).toMatch(/t\.test\//);

    await say("unsere-reisen");
    expect(lastReply()).toMatch(/Wie hei.t du/);

    await say("Vorname Nachname");
    expect(lastReply()).toMatch(/nennen/);

    await say("Vorname");
    expect(lastReply()).toMatch(/öffentlich/);

    await tap("onb:vis:guest", "Nur Eingeladene");
    expect(lastReply()).toMatch(/Deutsch/);

    await tap("onb:readers:one", "Nur Deutsch");
    expect(lastReply()).toMatch(/Währung/);

    await say("CHF");
    expect(lastReply()).toMatch(/https:\/\/t\.test\/unsere-reisen/);
    // A way in on the screen they are already looking at — single use,
    // fifteen minutes, the same relay link the journals route hands over.
    expect(lastReply()).toMatch(/t\.test\/unsere-reisen\/s\//);

    const config = JSON.parse(fs.readFileSync(path.join(dir, "unsere-reisen", "config.json"), "utf8"));
    expect(config.title).toBe("Unsere Reisen");
    expect(config.owner.email).toBe("neu@example.test");
    expect(config.owner.name).toBe("Vorname Nachname");
    expect(config.owner.nickname).toBe("Vorname");
    expect(config.owner.tel).toBe(TEL);
    expect(config.owner.telProvenMethod).toBe("whatsapp-inbound");
    expect(typeof config.owner.telProvenAt).toBe("string");
    expect(config.visibility).toBe("guest");
    expect(config.defaultLocale).toBe("de");
    expect(config.locales).toEqual(["de"]);
    expect(config.baseCurrency).toBe("CHF");

    // The half that makes the next message an owner's message.
    expect(journalForNumber(TEL)).toBe("unsere-reisen");

    // And nothing is left in flight.
    expect(fs.existsSync(path.join(dir, "whatsapp-onboarding", `${TEL}.json`))).toBe(false);
  });

  test("the next message after signing up is greeted as the owner, not onboarded again", async () => {
    await say("hi");
    await tap("onb:lang:en", "English");
    await say("second@example.test");
    await say(mailedCode());
    await say("A journal");
    await say("a-journal");
    await say("Somebody Else");
    await say("Somebody");
    await tap("onb:vis:public", "Public");
    await tap("onb:readers:one", "English only");
    await say("EUR");
    expect(journalForNumber(TEL)).toBe("a-journal");

    clearUserCache();
    clearConfigCache();
    const before = replies().length;
    await say("hello again");
    const after = replies().slice(before);
    // B1058's own first-message disclosure, from the bound path — not another
    // language card, and not the stranger sentence.
    expect(after.length).toBeGreaterThan(0);
    expect(after.map((r) => r.body).join("\n")).toMatch(/Reply 'yes' to continue/);
  });

  test("a wrong number is answered twice and then left alone", async () => {
    await say("is this the garage?");
    await say("hello??");
    await say("anyone there");
    await say("still nothing");
    // The card, then two corrections each followed by the card again. Nothing
    // for the fourth message: silence is the honest reading of a number that
    // is plainly not doing this.
    expect(replies().length).toBe(5);
  });

  test("STOP at any stage forgets the answers and says so", async () => {
    await say("hoi");
    await tap("onb:lang:de", "Deutsch");
    await say("weg@example.test");
    await say("STOPP");
    expect(lastReply()).toMatch(/Abgebrochen/);
    expect(fs.existsSync(path.join(dir, "whatsapp-onboarding", `${TEL}.json`))).toBe(false);
    // And starting again starts at the beginning rather than mid-flow.
    await say("doch wieder");
    expect(lastReply()).toMatch(/Choose a language/);
  });

  test("a taken address is corrected in the conversation", async () => {
    fs.mkdirSync(path.join(dir, "taken"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "taken", "config.json"),
      JSON.stringify({ title: "Someone", owner: { email: "other@example.test", name: "X", nickname: "X" } }),
    );
    clearUserCache();

    await say("hi");
    await tap("onb:lang:en", "English");
    await say("third@example.test");
    await say(mailedCode());
    await say("My journal");
    await say("taken");
    // The correction comes first and the question again after it, so it is
    // the pair that is checked rather than only the last bubble.
    expect(replies().some((r) => /is taken/.test(r.body))).toBe(true);
    await say("not-taken");
    expect(lastReply()).toMatch(/What is your name/);
  });

  test("a wrong code is refused without moving on", async () => {
    await say("hi");
    await tap("onb:lang:en", "English");
    await say("fourth@example.test");
    await say("000000");
    expect(lastReply()).toMatch(/six-digit code/);
    expect(replies().some((r) => /code is not right/.test(r.body))).toBe(true);
  });

  test("with signup switched off the channel says what it always said", async () => {
    fs.writeFileSync(
      path.join(dir, "config.json"),
      JSON.stringify({
        site: { name: "Fernscout Test", url: "https://t.test" },
        users: { reserved: [] },
        features: {
          whatsappInbound: { enabled: true },
          whatsapp: { enabled: true, backend: "dry-run" },
          mail: { enabled: true, transport: "file" },
        },
      }),
    );
    clearConfigCache();
    await say("Hallo");
    expect(lastReply()).toMatch(/private travel journal/);
  });

  /**
   * The list this flow is a third door onto. It cannot assert the wording —
   * the questions here are translated and the script's are English prose for
   * an agent — but it can fail when a question is added there and nobody
   * thought about here, which is the drift that actually happens.
   */
  test("the script still asks what firstQuestions asks", () => {
    expect(firstQuestions("https://t.test")).toHaveLength(8);
  });
});
