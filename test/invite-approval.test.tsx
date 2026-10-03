import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { POST as inviteAdminPOST } from "@/app/api/admin/invites/route";
import { POST as resumePOST } from "@/app/api/auth/signup/resume/route";
import { POST as codesPOST } from "@/app/api/auth/codes/route";
import { POST as redeemPOST } from "@/app/api/auth/codes/redeem/route";
import WelcomeDoor from "@/components/WelcomeDoor";
import LocaleProvider from "@/components/LocaleProvider";
import { dictionaryFor } from "@/lib/locales";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { NO_JOURNAL, issueCode } from "@/lib/auth";
import { removeInvite } from "@/lib/inviteList";
import { addInviteRequest } from "@/lib/inviteRequest";
import { resetRateLimitsForTests } from "@/lib/rateLimit";

/**
 * B-2772 / B-2773 / B-2780 — the invite-only path: an approval mails a
 * press-to-spend signup link, the pages point at each other, and the code
 * request does not say who is on the list.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: () => {} }),
  usePathname: () => "/welcome",
}));
vi.mock("@/lib/adminGate", () => ({ isInstanceAdmin: async () => true }));
const cookiesSet: string[] = [];
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: (name: string) => cookiesSet.push(name) }),
  headers: async () => new Headers(),
}));

let dir: string;
let data: string;
let ip = 0;

function writeConfig(features: Record<string, unknown> = {}) {
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "T", url: "https://t.test" },
      users: { reserved: [] },
      features: { mail: { enabled: true, transport: "file" }, signup: { inviteOnly: true }, ...features },
    }),
  );
  clearConfigCache();
}

function post(handler: (r: Request) => Promise<Response>, url: string, body: unknown) {
  ip += 1;
  return handler(
    new Request(`https://t.test${url}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": `203.0.113.${ip}` },
      body: JSON.stringify(body),
    }),
  );
}

const approve = (email: string) => post(inviteAdminPOST, "/api/admin/invites", { email, action: "add", notify: true });

function mails(): string[] {
  const bucket = path.join(data, "mail", ".mail");
  return fs.existsSync(bucket) ? fs.readdirSync(bucket).map((f) => fs.readFileSync(path.join(bucket, f), "utf8")) : [];
}

/** A mail's text part, decoded (the file transport writes base64). */
function textOf(mail: string): string {
  const part = /Content-Type: text\/plain[^]*?base64\r?\n\r?\n([^]*?)\r?\n--/.exec(mail);
  return part ? Buffer.from(part[1].replace(/\s+/g, ""), "base64").toString("utf8") : mail;
}

function pressToken(): string {
  const found = /\/welcome\/r\/([A-Za-z0-9_-]+)/.exec(textOf(mails().at(-1) ?? ""));
  if (!found) throw new Error("no press link in the newest mail");
  return found[1];
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-approval-"));
  data = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-approval-data-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATA_DIR = data;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "auth.db")}`;
  process.env.SESSION_SECRET = "b2772-test-secret-b2772-test-secret";
  writeConfig();
  clearUserCache();
  cookiesSet.length = 0;
  resetRateLimitsForTests();
  vi.spyOn(console, "log").mockImplementation(() => {});
  const { migrateToLatest } = await import("@/lib/db/migrate");
  await migrateToLatest(await getDatabase());
});

afterEach(async () => {
  await closeDatabase();
  for (const k of ["CONTENT_DIR", "DATA_DIR", "DATABASE_URL", "SESSION_SECRET"]) delete process.env[k];
  clearConfigCache();
  clearUserCache();
  vi.restoreAllMocks();
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(data, { recursive: true, force: true });
});

describe("B-2772 approving a request mails a link", () => {
  test("one mail; the press opens a signup session for that address, once, with no cookie", async () => {
    const res = await approve("guest@example.test");
    expect((await res.json()).mail).toBe("sent");
    expect(mails()).toHaveLength(1);
    expect(mails()[0]).toContain("guest@example.test");
    const token = pressToken();

    const pressed = await post(resumePOST, "/api/auth/signup/resume", { token });
    expect(pressed.status).toBe(200);
    const body = await pressed.json();
    expect(body.scope).toBe("signup");
    expect(typeof body.token).toBe("string");
    // No identity, guest or session cookie from the press.
    expect(cookiesSet).toEqual([]);
    expect(pressed.headers.get("set-cookie")).toBeNull();

    const again = await post(resumePOST, "/api/auth/signup/resume", { token });
    expect(again.status).toBe(401);
    expect((await again.json()).error).toBe("invalid_resume_link");
  });

  test("a link older than 7 days is refused", async () => {
    await approve("guest@example.test");
    const token = pressToken();
    const { db } = await getDatabase();
    await db
      .updateTable("login_codes")
      .set({ expires_at: new Date(Date.now() - 1000).toISOString() })
      .where("kind", "=", "signup-resume")
      .execute();
    expect((await post(resumePOST, "/api/auth/signup/resume", { token })).status).toBe(401);
  });

  test("a link whose address was taken off the list is refused", async () => {
    await approve("guest@example.test");
    const token = pressToken();
    await removeInvite("guest@example.test");
    const res = await post(resumePOST, "/api/auth/signup/resume", { token });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("signup_not_invited");
  });

  test("the mail is in the language the request asked in; send again mails a fresh link", async () => {
    await addInviteRequest("hans@example.test", "de");
    await new Promise((r) => setTimeout(r, 50));
    const before = mails().length;
    await approve("hans@example.test");
    const first = pressToken();
    expect(mails().length).toBe(before + 1);
    expect(textOf(mails().at(-1) ?? "")).toContain("Du bist dabei");
    await approve("hans@example.test");
    expect(mails().length).toBe(before + 2);
    // Only the newest mail's button works.
    expect((await post(resumePOST, "/api/auth/signup/resume", { token: first })).status).toBe(401);
    expect((await post(resumePOST, "/api/auth/signup/resume", { token: pressToken() })).status).toBe(200);
  });

  test("no mail on this server: the list entry is made and the answer says off", async () => {
    writeConfig({ mail: { enabled: false } });
    const res = await approve("guest@example.test");
    expect((await res.json()).mail).toBe("off");
    expect(mails()).toEqual([]);
  });

  test("an address that already keeps a journal is not mailed", async () => {
    fs.mkdirSync(path.join(dir, "oma"));
    fs.writeFileSync(path.join(dir, "oma", "config.json"), JSON.stringify({ owner: { email: "oma@example.test" } }));
    clearUserCache();
    const res = await approve("oma@example.test");
    expect((await res.json()).mail).toBe("has_journal");
    expect(mails()).toEqual([]);
  });

  test("typing an address into the list without notify stays silent", async () => {
    await post(inviteAdminPOST, "/api/admin/invites", { email: "quiet@example.test", action: "add" });
    expect(mails()).toEqual([]);
  });
});

describe("B-2780 the code request does not tell who is listed", () => {
  test("listed and unlisted answer the same 202 and body; only the listed one gets mail", async () => {
    await approve("guest@example.test");
    const listedBefore = mails().length;
    const listed = await post(codesPOST, "/api/auth/codes", { email: "guest@example.test", for: "signup" });
    const stranger = await post(codesPOST, "/api/auth/codes", { email: "stranger@example.test", for: "signup" });
    expect(stranger.status).toBe(listed.status);
    expect(listed.status).toBe(202);
    expect(await stranger.json()).toEqual(await listed.json());
    expect(mails().length).toBe(listedBefore + 1);
    expect(mails().some((m) => m.includes("stranger@example.test"))).toBe(false);
  });

  test("redeeming a signup code for an unlisted address is still refused", async () => {
    const { code } = await issueCode(NO_JOURNAL, "stranger@example.test", "signup");
    const res = await post(redeemPOST, "/api/auth/codes/redeem", { email: "stranger@example.test", code, for: "signup" });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("signup_not_invited");
  });
});

describe("B-2773 the pages point at each other", () => {
  function door(props: { inviteOnly?: boolean; inviteRequest?: boolean }) {
    return renderToStaticMarkup(
      <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
        <WelcomeDoor codeMinutes="20" identityEmail={null} signupEnabled {...props} />
      </LocaleProvider>,
    );
  }
  test("/welcome on an invite-only server links /invite", () => {
    const html = door({ inviteOnly: true, inviteRequest: true });
    expect(html).toContain('href="/invite"');
    expect(html).toContain("Request an invite");
  });
  test("/welcome on an open server does not", () => {
    expect(door({})).not.toContain('href="/invite"');
  });
});
