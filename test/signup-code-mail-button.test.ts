import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { issueSignupResumeLink, resolveSession } from "@/lib/auth";
import { getPendingSignup } from "@/lib/signup/pending";
import { composeSignupCodeMail, sendSignupCode } from "@/lib/signupCode";

/**
 * B2781 — the signup code mail's "Continue my signup" button. It must be in
 * the mail, a GET must spend nothing, and the press must give a signup-kind
 * session in the body and never a cookie, once, for seven days, behind the
 * gates the code redeem has.
 */

const sent: Array<{ to: string; text?: string; html?: string; subject: string }> = [];
vi.mock("@/lib/mail", async (orig) => ({
  ...(await orig<typeof import("@/lib/mail")>()),
  sendMail: async (m: (typeof sent)[number]) => void sent.push(m),
}));

let dir: string;
let caller = 0;

function writeConfig(signup: Record<string, unknown>) {
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({ site: { name: "T", url: "https://t.test" }, users: { reserved: [] }, features: { signup } }),
  );
  clearConfigCache();
}

async function press(token: string, headers: Record<string, string> = {}) {
  caller += 1;
  const { POST } = await import("@/app/api/auth/signup/resume/route");
  return POST(
    new Request("https://t.test/api/auth/signup/resume", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": `198.51.100.${caller}`, ...headers },
      body: JSON.stringify({ token }),
    }),
  );
}

beforeEach(async () => {
  sent.length = 0;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-signup-resume-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "auth.db")}`;
  process.env.SESSION_SECRET = "b2781-test-secret-b2781-test-secret";
  writeConfig({ inviteOnly: false });
  clearUserCache();
  const { migrateToLatest } = await import("@/lib/db/migrate");
  await migrateToLatest(await getDatabase());
});

afterEach(async () => {
  await closeDatabase();
  delete process.env.CONTENT_DIR;
  delete process.env.DATABASE_URL;
  delete process.env.SESSION_SECRET;
  clearConfigCache();
  clearUserCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("the signup code mail", () => {
  test("carries the code and the continue link", async () => {
    expect(await sendSignupCode("oma@example.test", "en")).toBe(true);
    const mail = sent[0];
    const body = `${mail.text ?? ""}${mail.html ?? ""}`;
    expect(body).toMatch(/https:\/\/t\.test\/welcome\/r\/[A-Za-z0-9_-]+/);
    expect(body).toContain("Continue my signup");
    expect(body).toMatch(/\d{6}/);
  });

  test("the preview composition without a link has no button", () => {
    const c = composeSignupCodeMail({ locale: "en", code: "123456", askedAt: "now" });
    expect(c.content.blocks.some((b) => b.kind === "button")).toBe(false);
  });
});

describe("pressing the button", () => {
  test("the page is a press page: nothing here spends the link on GET", async () => {
    const page = fs.readFileSync(path.join(process.cwd(), "app/welcome/r/[token]/page.tsx"), "utf8");
    expect(page).not.toMatch(/spendSignupResumeLink|redirect\(/);
    const token = await issueSignupResumeLink("oma@example.test");
    expect((await press(token)).status).toBe(200);
  });

  test("mints a signup session in the body, no cookie, and records the pending signup", async () => {
    const token = await issueSignupResumeLink("Oma@Example.test");
    expect(await getPendingSignup("oma@example.test")).toBeNull();
    const res = await press(token);
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toBeNull();
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, scope: "signup" });
    expect(await resolveSession(body.token, "signup")).toMatchObject({ email: "oma@example.test" });
    expect(await getPendingSignup("oma@example.test")).not.toBeNull();
  });

  test("is single use", async () => {
    const token = await issueSignupResumeLink("oma@example.test");
    expect((await press(token)).status).toBe(200);
    const again = await press(token);
    expect(again.status).toBe(401);
    expect((await again.json()).error).toBe("invalid_resume_link");
  });

  test("a newer mail retires the older button", async () => {
    const first = await issueSignupResumeLink("oma@example.test");
    const second = await issueSignupResumeLink("oma@example.test");
    expect((await press(first)).status).toBe(401);
    expect((await press(second)).status).toBe(200);
  });

  test("expires after seven days", async () => {
    const token = await issueSignupResumeLink("oma@example.test");
    const { db } = await getDatabase();
    await db
      .updateTable("login_codes")
      .set({ expires_at: new Date(Date.now() - 1000).toISOString() })
      .where("kind", "=", "signup-resume")
      .execute();
    expect((await press(token)).status).toBe(401);
  });

  test("an invented token is refused", async () => {
    expect((await press("nope")).status).toBe(401);
  });

  test("a foreign page cannot press, and the link survives the attempt", async () => {
    const token = await issueSignupResumeLink("oma@example.test");
    expect((await press(token, { origin: "https://evil.test" })).status).toBe(403);
    expect((await press(token)).status).toBe(200);
  });

  test("an address that already keeps a journal is told so", async () => {
    fs.mkdirSync(path.join(dir, "oma"));
    fs.writeFileSync(path.join(dir, "oma", "config.json"), JSON.stringify({ owner: { email: "oma@example.test" } }));
    clearUserCache();
    const token = await issueSignupResumeLink("oma@example.test");
    const res = await press(token);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("too_many_journals");
  });

  test("the invite list still decides", async () => {
    writeConfig({});
    const token = await issueSignupResumeLink("stranger@example.test");
    expect((await press(token)).status).toBe(403);
  });
});
