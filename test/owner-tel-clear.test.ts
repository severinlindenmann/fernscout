import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { closeDatabase, getDatabase } from "@/lib/db";
import { clearUserCache, getUser } from "@/lib/users";
import { createJournal } from "@/lib/journals";
import { journalForNumber, lockTel, reconcile } from "@/lib/registry";
import { clearOwnerTel, getOwnerTel, setOwnerTel } from "@/lib/ownerTel";

vi.mock("@/lib/adminGate", () => ({ isInstanceAdmin: vi.fn() }));
vi.mock("server-only", () => ({}));

/** B2833 — clearing the owner's number frees it everywhere. */

const TEL = "41760000033";
let dir: string;

function make(username: string, tel: string | null) {
  return createJournal({
    username,
    title: "T",
    ownerEmail: `${username}@example.test`,
    ownerName: "Robin",
    ownerNickname: "Robin",
    ...(tel ? { ownerTel: tel, ownerTelProvenAt: new Date().toISOString(), ownerTelProvenMethod: "sms" as const } : {}),
  });
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-owner-tel-clear-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATA_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "test.db")}`;
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "T", url: "https://t.test" },
      users: { reserved: ["admin"] },
      features: { signup: { inviteOnly: false }, auth: { enabled: true } },
    }),
  );
  clearConfigCache();
  clearUserCache();
  const { migrateToLatest } = await import("@/lib/db/migrate");
  await migrateToLatest(await getDatabase());
});

afterEach(async () => {
  await closeDatabase();
  for (const k of ["CONTENT_DIR", "DATA_DIR", "DATABASE_URL"]) delete process.env[k];
  clearConfigCache();
  clearUserCache();
  fs.rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("lockTel (B2833: a re-verified number is locked too)", () => {
  test("locks a second number to the journal and refuses it to another journal", () => {
    expect(make("alex", TEL).ok).toBe(true);
    expect(lockTel("alex", "41760000099")).toBe(true);
    expect(journalForNumber("41760000099")).toBe("alex");
    expect(journalForNumber(TEL)).toBe("alex");
    expect(lockTel("bea", "41760000099")).toBe(false);
    expect(lockTel("alex", "41760000099")).toBe(true);
  });
});

describe("clearOwnerTel", () => {
  test("frees the lock, the config fields and the row, and reconcile does not bring it back", async () => {
    expect(make("alex", TEL).ok).toBe(true);
    await setOwnerTel("alex", TEL, "sms");
    expect(journalForNumber(TEL)).toBe("alex");

    await clearOwnerTel("alex");

    expect(journalForNumber(TEL)).toBeNull();
    expect(await getOwnerTel("alex")).toBeNull();
    const owner = JSON.parse(fs.readFileSync(path.join(dir, "alex", "config.json"), "utf8")).owner;
    expect(owner.tel).toBeUndefined();
    expect(owner.telProvenAt).toBeUndefined();
    expect(owner.telProvenMethod).toBeUndefined();
    expect(owner.email).toBe("alex@example.test");
    expect(getUser("alex")).not.toBeNull();

    reconcile();
    expect(journalForNumber(TEL)).toBeNull();
  });

  test("another journal can then prove the same number, and clearing twice is harmless", async () => {
    make("alex", TEL);
    await clearOwnerTel("alex");
    await clearOwnerTel("alex");
    const second = make("robin", TEL);
    expect(second.ok).toBe(true);
    expect(journalForNumber(TEL)).toBe("robin");
  });

  test("never releases a lock another journal holds", async () => {
    make("alex", TEL);
    await clearOwnerTel("alex");
    make("robin", TEL);
    await clearOwnerTel("alex");
    expect(journalForNumber(TEL)).toBe("robin");
  });
});

describe("only the operator frees a number (B2833)", () => {
  const admin = async (yes: boolean) => {
    const gate = await import("@/lib/adminGate");
    vi.mocked(gate.isInstanceAdmin).mockResolvedValue(yes);
  };
  const post = async (user: string, headers: Record<string, string> = {}) => {
    const { POST } = await import("@/app/api/admin/owner-tel/route");
    return POST(
      new Request("https://t.test/api/admin/owner-tel", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "10.9.0.1", ...headers },
        body: JSON.stringify({ user }),
      }),
    );
  };

  test("the admin route frees row, config and lock, and shows only two digits", async () => {
    make("alex", TEL);
    await setOwnerTel("alex", TEL, "sms");
    await admin(true);
    const { GET } = await import("@/app/api/admin/owner-tel/route");
    const looked = await (await GET(new Request("https://t.test/api/admin/owner-tel?user=alex"))).json();
    expect(looked.masked).toBe("•".repeat(9) + "33");
    const res = await post("alex", { origin: "https://t.test" });
    expect(await res.json()).toMatchObject({ ok: true, freed: true });
    expect(journalForNumber(TEL)).toBeNull();
    expect(await getOwnerTel("alex")).toBeNull();
    expect(JSON.parse(fs.readFileSync(path.join(dir, "alex", "config.json"), "utf8")).owner.tel).toBeUndefined();
    expect(await (await post("alex")).json()).toMatchObject({ freed: false });
    expect((await post("nobody")).status).toBe(404);
  });

  test("a non-admin, a bearer header and a foreign origin change nothing", async () => {
    make("alex", TEL);
    await admin(false);
    expect((await post("alex")).status).toBe(404);
    await admin(true);
    expect((await post("alex", { authorization: "Bearer x" })).status).toBe(404);
    expect((await post("alex", { origin: "https://evil.test" })).status).toBe(403);
    expect(journalForNumber(TEL)).toBe("alex");
  });

  test("reconcile keeps a lock whose number is still in config even with an empty row", async () => {
    make("alex", TEL);
    await setOwnerTel("alex", TEL, "sms");
    const db = await getDatabase();
    await db.db.updateTable("owner_tel").set({ tel: null }).where("owner_id", "=", "alex").execute();
    reconcile();
    expect(journalForNumber(TEL)).toBe("alex");
  });
});
