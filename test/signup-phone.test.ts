import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { POST as journalsPOST } from "@/app/api/v1/journals/route";
import { POST as phoneRequestPOST } from "@/app/api/auth/signup/phone/route";
import { POST as phoneVerifyPOST } from "@/app/api/auth/signup/phone/redeem/route";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache, getUser } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { NO_JOURNAL, issueCode, verifyCode } from "@/lib/auth";

/**
 * B1065 — proving the number a journal is created with, and B1064's two
 * exemptions from needing one at all.
 */

let dir: string;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-signup-phone-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATA_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "auth.db")}`;
  process.env.SESSION_SECRET = "b1065-test-secret-b1065-test-secret";
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "T", url: "https://t.test" },
      users: { reserved: [] },
      features: { signup: { enabled: true }, auth: { enabled: true } },
    }),
  );
  clearConfigCache();
  clearUserCache();

  const { migrateToLatest } = await import("@/lib/db/migrate");
  await migrateToLatest(await getDatabase());
});

afterEach(async () => {
  await closeDatabase();
  delete process.env.CONTENT_DIR;
  delete process.env.DATA_DIR;
  delete process.env.DATABASE_URL;
  delete process.env.SESSION_SECRET;
  delete process.env.AUTH_DEV_CODE;
  clearConfigCache();
  clearUserCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

async function signupToken(email: string): Promise<string> {
  const { code } = await issueCode(NO_JOURNAL, email, "signup");
  const result = await verifyCode(NO_JOURNAL, email, code, "signup");
  if (!result.ok) throw new Error("could not mint a signup token");
  return result.token;
}

function phoneRequest(token: string, tel: string) {
  return phoneRequestPOST(
    new Request("https://example.test/api/auth/signup/phone", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ tel }),
    }),
  );
}

function phoneVerify(token: string, id: string, code: string) {
  return phoneVerifyPOST(
    new Request("https://example.test/api/auth/signup/phone/redeem", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ id, code }),
    }),
  );
}

const GOOD = {
  title: "A journal",
  ownerName: "Robin Traveller",
  ownerNickname: "Robin",
  visibility: "public",
  defaultLocale: "en",
  locales: ["en"],
  baseCurrency: "CHF",
};

function createJournalCall(token: string, extra: Record<string, unknown>) {
  return journalsPOST(
    new Request("https://example.test/api/v1/journals", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ ...GOOD, ...extra }),
    }),
  );
}

describe("proving a number", () => {
  test("start then check, and the code is single-use", async () => {
    const token = await signupToken("robin@example.test");
    const started = await phoneRequest(token, "+41 76 000 00 01");
    expect(started.status).toBe(202);
    const { id } = (await started.json()) as { id: string };

    // Wrong code first.
    const wrong = await phoneVerify(token, id, "000000");
    expect(wrong.status).toBe(401);

    // The code was written to disk by the dry-run backend — read it back,
    // the way an agent driving a real signup would have to (there is no
    // account to check an inbox with).
    const phoneFiles = fs.readdirSync(path.join(dir, "phone"));
    expect(phoneFiles.length).toBe(1);
    const written = JSON.parse(fs.readFileSync(path.join(dir, "phone", phoneFiles[0]), "utf8")) as {
      code: string;
    };

    const ok = await phoneVerify(token, id, written.code);
    expect(ok.status).toBe(200);
    const okBody = (await ok.json()) as { tel: string };
    expect(okBody.tel).toBe("41760000001");

    // Spent — the same code does not work twice.
    const again = await phoneVerify(token, id, written.code);
    expect(again.status).toBe(401);
  });

  test("a journal cannot be created without proving a number first", async () => {
    const token = await signupToken("noproof@example.test");
    const result = await createJournalCall(token, { username: "noproof" });
    expect(result.status).toBe(400);
    const body = (await result.json()) as { error: string };
    expect(body.error).toBe("phone_required");
  });

  test("once proven, the number is attached to the journal automatically", async () => {
    const token = await signupToken("proven@example.test");
    const started = await phoneRequest(token, "41760000002");
    const { id } = (await started.json()) as { id: string };
    const files = fs.readdirSync(path.join(dir, "phone"));
    const { code } = JSON.parse(fs.readFileSync(path.join(dir, "phone", files[0]), "utf8")) as {
      code: string;
    };
    await phoneVerify(token, id, code);

    const created = await createJournalCall(token, { username: "proven-journal" });
    expect(created.status).toBe(201);
    const user = getUser("proven-journal");
    expect(user?.owner.tel).toBe("41760000002");
  });

  test("a test- journal is exempt and needs no phone step", async () => {
    const token = await signupToken("tester@example.test");
    const created = await createJournalCall(token, { username: "test-exempt" });
    expect(created.status).toBe(201);
    expect(getUser("test-exempt")?.owner.tel).toBeUndefined();
  });

  test("a number already proven for another journal is refused", async () => {
    const first = await signupToken("first@example.test");
    const started1 = await phoneRequest(first, "41760000003");
    const { id: id1 } = (await started1.json()) as { id: string };
    const files1 = fs.readdirSync(path.join(dir, "phone"));
    const { code: code1 } = JSON.parse(
      fs.readFileSync(path.join(dir, "phone", files1[files1.length - 1]), "utf8"),
    ) as { code: string };
    await phoneVerify(first, id1, code1);
    expect((await createJournalCall(first, { username: "owns-it" })).status).toBe(201);

    const second = await signupToken("second@example.test");
    const started2 = await phoneRequest(second, "41760000003");
    const { id: id2 } = (await started2.json()) as { id: string };
    const files2 = fs.readdirSync(path.join(dir, "phone"));
    const { code: code2 } = JSON.parse(
      fs.readFileSync(path.join(dir, "phone", files2[files2.length - 1]), "utf8"),
    ) as { code: string };
    await phoneVerify(second, id2, code2);

    const refused = await createJournalCall(second, { username: "wants-it-too" });
    expect(refused.status).toBe(409);
    const refusedBody = (await refused.json()) as { error: string };
    expect(refusedBody.error).toBe("tel_taken");
  });

  test("a national number with no country code is refused", async () => {
    const token = await signupToken("national@example.test");
    const result = await phoneRequest(token, "076 000 00 04");
    expect(result.status).toBe(400);
  });
});
