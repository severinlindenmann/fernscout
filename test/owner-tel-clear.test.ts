import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { closeDatabase, getDatabase } from "@/lib/db";
import { clearUserCache, getUser } from "@/lib/users";
import { createJournal } from "@/lib/journals";
import { journalForNumber, reconcile } from "@/lib/registry";
import { clearOwnerTel, getOwnerTel, setOwnerTel } from "@/lib/ownerTel";

vi.mock("@/lib/contacts/session", () => ({ isOwner: vi.fn() }));
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

describe("DELETE /api/web/{user}/owner-tel", () => {
  const call = async (headers: Record<string, string> = {}) => {
    const { DELETE } = await import("@/app/api/web/[user]/owner-tel/route");
    return DELETE(new Request("https://t.test/api/web/alex/owner-tel", { method: "DELETE", headers }), {
      params: Promise.resolve({ user: "alex" }),
    } as never);
  };
  const owner = async (yes: boolean) => {
    const session = await import("@/lib/contacts/session");
    vi.mocked(session.isOwner).mockResolvedValue(yes);
  };

  test("refuses a bearer token, a foreign origin and a non-owner, and changes nothing", async () => {
    make("alex", TEL);
    await owner(true);
    expect((await call({ authorization: "Bearer x" })).status).toBe(403);
    expect((await call({ origin: "https://evil.test" })).status).toBe(403);
    await owner(false);
    expect((await call()).status).toBe(403);
    expect(journalForNumber(TEL)).toBe("alex");
  });

  test("the owner's own cookie frees the number", async () => {
    make("alex", TEL);
    await owner(true);
    expect((await call({ origin: "https://t.test" })).status).toBe(200);
    expect(journalForNumber(TEL)).toBeNull();
  });
});
