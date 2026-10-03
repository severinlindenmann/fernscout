import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { POST as journalsPOST } from "@/app/api/v2/journals/route";
import { POST as phoneRequestPOST } from "@/app/api/auth/signup/phone/route";
import { POST as phoneVerifyPOST } from "@/app/api/auth/signup/phone/redeem/route";
import { POST as redeemPOST } from "@/app/api/auth/codes/redeem/route";
import { GET as statePOST } from "@/app/api/auth/signup/state/route";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { NO_JOURNAL, issueCode, verifyCode } from "@/lib/auth";
import { createPhoneLink, claimPhoneLink, pollPhoneLink } from "@/lib/phoneVerify/inboundLink";
import { reserve } from "@/lib/registry";
import { getPendingSignup, purgePendingSignups } from "@/lib/signup/pending";

/**
 * B2804 / B2805 — a signup that stopped keeps what was proven, and a number
 * that already keeps a journal is refused when it is proven, not at create.
 */

const jar: { set: Array<[string, string]> } = { set: [] };
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => undefined,
    set: (name: string, value: string) => jar.set.push([name, value]),
  }),
}));

let dir: string;
let ip = 0;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-signup-resume-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATA_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "auth.db")}`;
  process.env.SESSION_SECRET = "b2804-test-secret-b2804-test-secret";
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "T", url: "https://t.test" },
      users: { reserved: [] },
      features: {
        signup: { inviteOnly: false },
        auth: { enabled: true },
        whatsapp: { enabled: false, number: "+41760000099" },
      },
    }),
  );
  clearConfigCache();
  clearUserCache();
  jar.set = [];
  const { migrateToLatest } = await import("@/lib/db/migrate");
  await migrateToLatest(await getDatabase());
});

afterEach(async () => {
  await closeDatabase();
  for (const k of ["CONTENT_DIR", "DATA_DIR", "DATABASE_URL", "SESSION_SECRET"]) delete process.env[k];
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

const auth = (token: string) => ({ authorization: `Bearer ${token}`, "content-type": "application/json" });

const state = (token: string) =>
  statePOST(new Request("https://t.test/api/auth/signup/state", { headers: auth(token) })).then((r) => r.json()) as Promise<
    Record<string, unknown>
  >;

function phoneRequest(token: string, tel: string) {
  return phoneRequestPOST(
    new Request("https://t.test/api/auth/signup/phone", {
      method: "POST",
      headers: auth(token),
      body: JSON.stringify({ tel }),
    }),
  );
}

function phoneVerify(token: string, body: Record<string, unknown>) {
  return phoneVerifyPOST(
    new Request("https://t.test/api/auth/signup/phone/redeem", {
      method: "POST",
      headers: auth(token),
      body: JSON.stringify(body),
    }),
  );
}

/** Request a code for `tel`, read it off disk (dry-run), redeem it. */
async function proveByCode(token: string, tel: string): Promise<Response> {
  const started = await phoneRequest(token, tel);
  expect(started.status).toBe(202);
  const { id } = (await started.json()) as { id: string };
  const files = fs.readdirSync(path.join(dir, "phone")).sort();
  const { code } = JSON.parse(fs.readFileSync(path.join(dir, "phone", files[files.length - 1]), "utf8")) as {
    code: string;
  };
  return phoneVerify(token, { id, code });
}

function createJournal(token: string, username: string) {
  return journalsPOST(
    new Request("https://t.test/api/v2/journals", {
      method: "POST",
      headers: auth(token),
      body: JSON.stringify({
        title: "A journal",
        username,
        ownerName: "Robin Traveller",
        ownerNickname: "Robin",
        visibility: "public",
        defaultLocale: "en",
        locales: ["en"],
        baseCurrency: "CHF",
      }),
    }),
  );
}

async function ownJournal(email: string, username: string, tel: string) {
  const token = await signupToken(email);
  expect((await proveByCode(token, tel)).status).toBe(200);
  expect((await createJournal(token, username)).status).toBe(201);
}

describe("B2804 resume", () => {
  test("email only: the redeem leaves a pending row and an identity cookie; state says phone is open", async () => {
    const { code } = await issueCode(NO_JOURNAL, "robin@example.test", "signup");
    ip += 1;
    const res = await redeemPOST(
      new Request("https://t.test/api/auth/codes/redeem", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": `203.0.113.${ip}` },
        body: JSON.stringify({ for: "signup", email: "robin@example.test", code }),
      }),
    );
    expect(res.status).toBe(200);
    const { token } = (await res.json()) as { token: string };
    expect(jar.set.map(([n]) => n)).toContain("fs_identity");

    expect(await getPendingSignup("robin@example.test")).toMatchObject({ phone: null });
    expect(await state(token)).toMatchObject({ emailProven: true, phoneProven: false, phoneRequired: true });
  });

  test("the state route wants the signup token", async () => {
    const res = await statePOST(new Request("https://t.test/api/auth/signup/state"));
    expect(res.status).toBe(401);
  });

  test("phone proven, then another device: a new signup session already has it", async () => {
    const first = await signupToken("robin@example.test");
    expect((await proveByCode(first, "41760000001")).status).toBe(200);

    const second = await signupToken("robin@example.test"); // email + one code, elsewhere
    expect(await state(second)).toMatchObject({ phoneProven: true, telMasked: "+•••••••••01" });

    // The proof is attached for real: create needs no phone step.
    expect((await createJournal(second, "robin-trips")).status).toBe(201);
    expect(await getPendingSignup("robin@example.test")).toBeNull();
  });

  test("a number proven more than seven days ago is asked for again", async () => {
    const first = await signupToken("robin@example.test");
    await proveByCode(first, "41760000001");
    const { db } = await getDatabase();
    await db
      .updateTable("pending_signups")
      .set({ phone_proven_at: new Date(Date.now() - 8 * 86400_000).toISOString() })
      .execute();
    expect(await state(await signupToken("robin@example.test"))).toMatchObject({ phoneProven: false });
  });

  test("a WhatsApp claim is recorded on the pending row of the address that asked, and only that one", async () => {
    await signupToken("robin@example.test");
    await signupToken("other@example.test");
    const link = await createPhoneLink("robin@example.test", "en");
    expect(link).not.toBeNull();

    expect(await claimPhoneLink(link!.text, "41790000005")).toEqual({ outcome: "confirmed", locale: "en" });
    expect((await getPendingSignup("robin@example.test"))?.phone).toBe("41790000005");
    expect((await getPendingSignup("robin@example.test"))?.phoneProvenMethod).toBe("whatsapp-inbound");
    expect((await getPendingSignup("other@example.test"))?.phone).toBeNull();

    // The other address cannot collect it by polling, and a fresh tab of the owner's finds it proven.
    expect(await pollPhoneLink(link!.id, "other@example.test")).toEqual({ status: "expired" });
    expect(await state(await signupToken("robin@example.test"))).toMatchObject({ phoneProven: true });
  });

  test("the purge removes rows older than eight days and keeps newer ones", async () => {
    await signupToken("old@example.test");
    await signupToken("new@example.test");
    const { db } = await getDatabase();
    await db
      .updateTable("pending_signups")
      .set({ email_proven_at: new Date(Date.now() - 9 * 86400_000).toISOString() })
      .where("email", "=", "old@example.test")
      .execute();
    await db
      .updateTable("pending_signups")
      .set({ email_proven_at: new Date(Date.now() - 7 * 86400_000).toISOString() })
      .where("email", "=", "new@example.test")
      .execute();
    expect(await purgePendingSignups()).toBe(1);
    const left = await db.selectFrom("pending_signups").select("email").execute();
    expect(left.map((r) => r.email)).toEqual(["new@example.test"]);
  });
});

describe("B2805 tel_taken at proof time", () => {
  test("SMS request: refused before any code is written", async () => {
    await ownJournal("first@example.test", "first-one", "41760000003");
    const files = () => fs.readdirSync(path.join(dir, "phone")).length;
    const before = files();
    const res = await phoneRequest(await signupToken("second@example.test"), "41760000003");
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe("tel_taken");
    expect(files()).toBe(before);
  });

  test("SMS redeem: a number taken between request and redeem is refused and not recorded", async () => {
    const late = await signupToken("late@example.test");
    const started = await phoneRequest(late, "41760000004");
    const { id } = (await started.json()) as { id: string };
    const files = fs.readdirSync(path.join(dir, "phone"));
    const { code } = JSON.parse(fs.readFileSync(path.join(dir, "phone", files[0]), "utf8")) as { code: string };

    // Somebody else's journal takes the number meanwhile (a second code for it would supersede this one).
    expect(reserve("quick-one", "quick@example.test", "41760000004").ok).toBe(true);

    const res = await phoneVerify(late, { id, code });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe("tel_taken");
    expect((await getPendingSignup("late@example.test"))?.phone).toBeNull();
  });

  test("inbound claim: refused, not recorded, and the poll says tel_taken", async () => {
    await ownJournal("first@example.test", "first-one", "41760000003");
    await signupToken("second@example.test");
    const link = await createPhoneLink("second@example.test", "en");
    expect(await claimPhoneLink(link!.text, "41760000003")).toEqual({ outcome: "taken", locale: "en" });
    expect((await getPendingSignup("second@example.test"))?.phone).toBeNull();
    expect(await pollPhoneLink(link!.id, "second@example.test")).toEqual({ status: "tel_taken" });
  });
});
