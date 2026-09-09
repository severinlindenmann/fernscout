import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { migrateToLatest } from "@/lib/db/migrate";
import { createJournal, setJournalFeatures } from "@/lib/journals";
import { forget } from "@/lib/helper/thread";
import { getDays, AS_AUTHOR } from "@/lib/entries";
import { tripRef } from "@/lib/trips";
import type { InboundMessage } from "@/lib/whatsapp/inbound";
import { handleInboundMessage } from "@/lib/whatsapp/dispatch";

/**
 * B1074 — a location pin becomes a draft day (or a named refusal), and a
 * shared contact card becomes a guest invite link the owner forwards
 * themselves — option A, reusing `createInvite` unchanged.
 */

let dir: string;

function textMessage(from: string, id: string, body: string): InboundMessage {
  return { kind: "text", id, from, timestamp: "1700000000", body };
}

function locationMessage(from: string, id: string, timestamp: string): InboundMessage {
  return { kind: "location", id, from, timestamp, latitude: 46.5, longitude: 7.9 };
}

function contactsMessage(
  from: string,
  id: string,
  contacts: Array<{ name?: string; phones?: string[]; emails?: string[] }>,
): InboundMessage {
  return { kind: "contacts", id, from, timestamp: "1700000000", contacts };
}

function repliesTo(username: string): Record<string, unknown>[] {
  const replyDir = path.join(dir, username, "whatsapp-replies");
  if (!fs.existsSync(replyDir)) return [];
  return fs
    .readdirSync(replyDir)
    .sort()
    .map((f) => JSON.parse(fs.readFileSync(path.join(replyDir, f), "utf8")));
}

function writeTrip(username: string, id: string, start: string, end: string, title = "A trip"): void {
  const tripDir = path.join(dir, username, "trips", id);
  fs.mkdirSync(path.join(tripDir, "entries"), { recursive: true });
  fs.writeFileSync(
    path.join(tripDir, "trip.md"),
    ["---", `id: ${id}`, `title: ${title}`, `start: "${start}"`, `end: "${end}"`, "visibility: private", "---", "", "Intro."].join("\n"),
  );
}

async function bindGreetAcknowledge(username: string, tel: string): Promise<void> {
  const created = createJournal({
    username,
    title: "A journal",
    ownerEmail: `${username}@example.test`,
    ownerName: "Owner",
    ownerNickname: "Owner",
    defaultLocale: "en",
    ownerTel: tel,
    ownerTelProvenAt: new Date().toISOString(),
    ownerTelProvenMethod: "sms",
  });
  expect(created.ok).toBe(true);
  expect(setJournalFeatures(username, { whatsappInbound: true }).ok).toBe(true);
  await handleInboundMessage(textMessage(tel, `wamid.${username}.greet`, "hi"));
  await handleInboundMessage(textMessage(tel, `wamid.${username}.yes`, "yes"));
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-whatsapp-loccon-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATA_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "test.db")}`;
  process.env.WHATSAPP_APP_SECRET = "test-secret";
  process.env.WHATSAPP_VERIFY_TOKEN = "test-token";
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "Fernscout Test", url: "https://t.test" },
      users: { reserved: [] },
      features: { whatsappInbound: { enabled: true }, whatsapp: { enabled: true, backend: "dry-run" } },
    }),
  );
  clearConfigCache();
  clearUserCache();
  forget("locontest");
  await migrateToLatest(await getDatabase());
});

afterEach(async () => {
  await closeDatabase();
  forget("locontest");
  delete process.env.CONTENT_DIR;
  delete process.env.DATA_DIR;
  delete process.env.DATABASE_URL;
  delete process.env.WHATSAPP_APP_SECRET;
  delete process.env.WHATSAPP_VERIFY_TOKEN;
  clearConfigCache();
  clearUserCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("a location pin", () => {
  test("with a trip covering that date creates a draft day carrying only the coordinates", async () => {
    await bindGreetAcknowledge("locontest", "41760020202");
    writeTrip("locontest", "reise", "2023-11-01", "2023-11-20");

    // 2023-11-14 12:00:00 UTC
    await handleInboundMessage(locationMessage("41760020202", "wamid.loc-1", "1699963200"));

    const days = getDays(tripRef("locontest", "reise"), AS_AUTHOR);
    const day = days.find((d) => d.date === "2023-11-14");
    expect(day).toBeDefined();
    expect(day?.lead.lat).toBeCloseTo(46.5);
    expect(day?.lead.lng).toBeCloseTo(7.9);

    const files = repliesTo("locontest");
    expect(String(files[files.length - 1].body)).toContain("2023-11-14");

    // B1193: the whole round trip was a WhatsApp webhook, so the thread note
    // `wrote()` left behind must carry that origin, not the "web" default.
    const { db } = (await getDatabase())!;
    const row = await db.selectFrom("helper_threads").selectAll().where("owner_id", "=", "locontest").executeTakeFirst();
    expect(row?.channel).toBe("whatsapp");
  });

  test("with no trip covering that date is refused, naming the date", async () => {
    await bindGreetAcknowledge("locontest", "41760030303");
    // No trip written at all.
    await handleInboundMessage(locationMessage("41760030303", "wamid.loc-2", "1699963200"));

    const files = repliesTo("locontest");
    const last = String(files[files.length - 1].body);
    expect(last).toContain("2023-11-14");
  });

  test("with two trips covering the date, the most recently created wins", async () => {
    await bindGreetAcknowledge("locontest", "41760040404");
    writeTrip("locontest", "older", "2023-11-01", "2023-11-20", "Older trip");
    await new Promise((resolve) => setTimeout(resolve, 20));
    writeTrip("locontest", "newer", "2023-11-05", "2023-11-25", "Newer trip");

    await handleInboundMessage(locationMessage("41760040404", "wamid.loc-3", "1699963200"));

    const newerDays = getDays(tripRef("locontest", "newer"), AS_AUTHOR);
    const olderDays = getDays(tripRef("locontest", "older"), AS_AUTHOR);
    expect(newerDays.some((d) => d.date === "2023-11-14")).toBe(true);
    expect(olderDays.some((d) => d.date === "2023-11-14")).toBe(false);
  });
});

describe("a shared contact card", () => {
  test("with an email makes a guest invite link, unsent", async () => {
    await bindGreetAcknowledge("locontest", "41760050505");
    await handleInboundMessage(
      contactsMessage("41760050505", "wamid.card-1", [
        { name: "Anna Muster", phones: ["+41791234567"], emails: ["anna@example.test"] },
      ]),
    );

    const files = repliesTo("locontest");
    const last = String(files[files.length - 1].body);
    expect(last).toContain("Anna Muster");
    expect(last).toMatch(/invite\/guest\//);
  });

  test("with no email stops and says one is needed", async () => {
    await bindGreetAcknowledge("locontest", "41760060606");
    await handleInboundMessage(
      contactsMessage("41760060606", "wamid.card-2", [{ name: "Bruno", phones: ["+41791111111"] }]),
    );

    const files = repliesTo("locontest");
    const last = String(files[files.length - 1].body);
    expect(last).toContain("Bruno");
    expect(last).not.toMatch(/invite\/guest\//);
  });
});
