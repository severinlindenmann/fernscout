import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache, parseUserConfig } from "@/lib/config";
import { clearUserCache, getUser } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { journalProfile, setJournalProfile } from "@/lib/journals";
import { getOwnerTel } from "@/lib/ownerTel";

/**
 * B614 — `owner.tel`, the number the owner's own free WhatsApp copy of a day
 * goes to. B1654 moved it off `config.json` into its own central store, and
 * — after the owner's own security review of the first draft — made it
 * proof-only: nothing writes it without a passcode confirming the caller
 * actually holds the number. `PATCH /api/v1/{user}/config` used to accept it
 * checked only for E.164 shape, which let an owner token point a journal's
 * WhatsApp copies at a number of its own choosing.
 *
 * Two properties carried over from before, and they still pull in opposite
 * directions on purpose. The number is stored **normalised**, so the send
 * path never re-parses a string. And it is normalised with **no default
 * country code**: `whatsappCountryCode()` is the operator's env, and a
 * journal that parsed yesterday must not stop parsing because the operator
 * edited it.
 */

const OWNER = "ana";
const OWNER_EMAIL = "ana@example.test";

let dir: string;
let calls = 0;

function journalFile(tel?: string): Record<string, unknown> {
  return {
    title: "The Solo Journal",
    owner: { name: "Ana B", nickname: "Ana", email: OWNER_EMAIL, ...(tel ? { tel } : {}) },
    startLocation: "Zurich",
    defaultLocale: "en",
    locales: ["en"],
    baseCurrency: "CHF",
    displayCurrencies: ["CHF"],
    units: "metric",
    features: { whatsapp: { enabled: true } },
  };
}

function writeJournal(tel?: string) {
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "F", url: "https://example.test", defaultUser: OWNER },
      users: { reserved: [] },
      features: { auth: { enabled: true }, whatsapp: { enabled: true } },
    }),
  );
  fs.mkdirSync(path.join(dir, OWNER, "trips"), { recursive: true });
  fs.writeFileSync(path.join(dir, OWNER, "config.json"), JSON.stringify(journalFile(tel)));
  clearConfigCache();
  clearUserCache();
}

/** `config.json` as it stands on disk. */
function onDisk(): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(dir, OWNER, "config.json"), "utf8")) as Record<
    string,
    unknown
  >;
}

function headers(extra: Record<string, string> = {}): Record<string, string> {
  calls += 1;
  return { "content-type": "application/json", "x-forwarded-for": `10.7.4.${calls % 250}`, ...extra };
}

async function ownerToken(): Promise<string> {
  const { issueCode, verifyCode } = await import("@/lib/auth");
  const { code } = await issueCode(OWNER, OWNER_EMAIL, "agent");
  const result = await verifyCode(OWNER, OWNER_EMAIL, code, "agent");
  if (!result.ok) throw new Error("no owner token");
  return result.token;
}

async function call(
  method: "GET" | "POST" | "DELETE",
  routeSuffix: string,
  token: string,
  body?: unknown,
) {
  const mod = (await import(`@/app/api/v2/[user]/owner/tel${routeSuffix}/route`)) as Record<
    string,
    (req: Request, ctx: unknown) => Promise<Response>
  >;
  const handler = mod[method];
  const response = await handler(
    new Request(`https://example.test/api/v2/${OWNER}/owner/tel${routeSuffix}`, {
      method,
      headers: headers({ authorization: `Bearer ${token}` }),
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }),
    { params: Promise.resolve({ user: OWNER }) },
  );
  const text = await response.text();
  return { status: response.status, body: (text ? JSON.parse(text) : {}) as Record<string, unknown> };
}

/** The code the dry-run phone backend wrote, for the most recent request. */
function latestPhoneCode(): string {
  const files = fs.readdirSync(path.join(dir, "phone"));
  const newest = files.sort().at(-1)!;
  return (JSON.parse(fs.readFileSync(path.join(dir, "phone", newest), "utf8")) as { code: string }).code;
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-owner-tel-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATA_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "db.sqlite")}`;
  process.env.SESSION_SECRET = "88".repeat(32);
  writeJournal();
  await migrate();
});

async function migrate() {
  const { migrateToLatest } = await import("@/lib/db/migrate");
  await migrateToLatest(await getDatabase());
}

afterEach(async () => {
  await closeDatabase();
  delete process.env.CONTENT_DIR;
  delete process.env.DATA_DIR;
  delete process.env.DATABASE_URL;
  delete process.env.SESSION_SECRET;
  clearConfigCache();
  clearUserCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("the number in the file", () => {
  test("every international form is stored as the same digits", () => {
    for (const raw of ["+41 76 000 00 00", "+41760000000", "0041 76 000 00 00", "41760000000"]) {
      expect(parseUserConfig(OWNER, journalFile(raw)).owner.tel).toBe("41760000000");
    }
  });

  test("absent is the normal case, and is not an empty string", () => {
    expect(parseUserConfig(OWNER, journalFile()).owner.tel).toBeUndefined();
  });

  test("a national number is refused, and the message says why", () => {
    expect(() => parseUserConfig(OWNER, journalFile("076 000 00 00"))).toThrow(
      /owner\.tel must be a telephone number with its country code/,
    );
  });

  test("something that is not a number at all is refused too", () => {
    expect(() => parseUserConfig(OWNER, journalFile("ring me"))).toThrow(/owner\.tel/);
  });
});

describe("there is no bare write, anywhere", () => {
  test("setJournalProfile refuses ownerTel outright, and says where to go instead", () => {
    writeJournal();
    const result = setJournalProfile(OWNER, { ownerTel: "+41 76 000 00 00" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("unsupported_field");
    expect(result.message).toMatch(/owner\/tel\/verify/);
    expect(result.message).toMatch(/verify\/redeem/);
    // Nothing was written.
    expect(onDisk().owner).not.toHaveProperty("tel");
  });

  test("the owner block as a whole is refused too, and points at the same door", () => {
    writeJournal();
    const result = setJournalProfile(OWNER, { owner: { tel: "+41760000000" } });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("unsupported_field");
    expect(result.message).toMatch(/B1654/);
  });

  test("a journal already carrying owner.tel on disk is unaffected — nothing rewrites it", () => {
    writeJournal("+41760000000");
    const result = setJournalProfile(OWNER, { title: "Renamed" });
    expect(result.ok).toBe(true);
    // Stored verbatim, the same as any other write to `journalFile` above —
    // `parseUserConfig` is what normalises a number on the way IN, and
    // nothing here asked it to. The point of the test is that `tel` is
    // still there at all.
    expect(onDisk().owner).toMatchObject({ tel: "+41760000000" });
  });
});

describe("a number already on disk keeps working, with no migration script", () => {
  test("getOwnerTel falls back to config.json when there is no row yet", async () => {
    writeJournal("+41760000000");
    const record = await getOwnerTel(OWNER);
    expect(record).toEqual({ tel: "41760000000", provenAt: null, provenMethod: null });
  });

  test("no number in the file and no row either is null, not an empty string", async () => {
    writeJournal();
    expect(await getOwnerTel(OWNER)).toBeNull();
  });

  test("journalProfile() still reads the file value back — the read-back an old caller checks its own work against", () => {
    writeJournal("+41760000000");
    const user = getUser(OWNER)!;
    expect(journalProfile(user).ownerTel).toBe("41760000000");
  });
});

describe("proving a number through the v2 door", () => {
  test("start then redeem writes a row, and the row wins over the file from then on", async () => {
    writeJournal("+41760000099"); // an old, file-only number
    const token = await ownerToken();

    const started = await call("POST", "/verify", token, { tel: "+41 76 000 00 02" });
    expect(started.status).toBe(202);
    const code = latestPhoneCode();

    const redeemed = await call("POST", "/verify/redeem", token, { id: started.body.id, code });
    expect(redeemed.status).toBe(200);
    expect(redeemed.body).toMatchObject({ tel: "41760000002", provenMethod: "sms" });
    expect(typeof redeemed.body.provenAt).toBe("string");

    // The row is authoritative now — the file's old number is not what
    // anything reads any more, even though nothing erased it from disk.
    const record = await getOwnerTel(OWNER);
    expect(record?.tel).toBe("41760000002");
    expect(onDisk().owner).toMatchObject({ tel: "+41760000099" });

    const read = await call("GET", "", token);
    expect(read.body).toMatchObject({ tel: "41760000002", provenMethod: "sms" });
  });

  test("the wrong code is refused, and nothing is written", async () => {
    writeJournal();
    const token = await ownerToken();
    const started = await call("POST", "/verify", token, { tel: "+41 76 000 00 03" });
    const redeemed = await call("POST", "/verify/redeem", token, { id: started.body.id, code: "000000" });
    expect(redeemed.status).toBe(401);
    expect(await getOwnerTel(OWNER)).toBeNull();
  });

  test("a national number is refused rather than guessed, and nothing is sent", async () => {
    writeJournal();
    const token = await ownerToken();
    const started = await call("POST", "/verify", token, { tel: "076 000 00 00" });
    expect(started.status).toBe(400);
    expect(started.body.message).toMatch(/country code/);
  });

  test("clearing writes an explicit no-number row, which does NOT fall back to the file", async () => {
    writeJournal("+41760000009");
    const token = await ownerToken();
    const cleared = await call("DELETE", "", token);
    expect(cleared.status).toBe(200);
    expect(cleared.body).toMatchObject({ tel: null });
    expect(await getOwnerTel(OWNER)).toBeNull();
    // The file is untouched — clearing is a database fact, not a file edit.
    expect(onDisk().owner).toMatchObject({ tel: "+41760000009" });
  });

  test("a trip-scoped token cannot touch any of this — B1652's own line", async () => {
    const { issueCode, verifyCode } = await import("@/lib/auth");
    const { createTrip } = await import("@/lib/tripWrite");
    const trip = createTrip(OWNER, {
      id: "solo-trip",
      title: "Solo",
      start: "2026-01-01",
      end: "2026-01-05",
      visibility: "private",
    });
    if (!trip.ok) throw new Error(trip.message);
    const { code } = await issueCode(OWNER, OWNER_EMAIL, "agent", { trip: "solo-trip" });
    const result = await verifyCode(OWNER, OWNER_EMAIL, code, "agent");
    if (!result.ok) throw new Error("no trip token");

    const started = await call("POST", "/verify", result.token, { tel: "+41 76 000 00 04" });
    expect(started.status).toBe(403);
    const read = await call("GET", "", result.token);
    expect(read.status).toBe(403);
  });
});
