import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { POST } from "@/app/api/v1/journals/route";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache, getUser, listedUsernames } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { SIGNUP_OWNER, issueCode, verifyCode } from "@/lib/auth";
import { instanceDocumentation } from "@/lib/api/documentation";

/**
 * B263 — visibility and defaultLocale must be asked, never assumed. B277 —
 * so must locales, the question B263 itself left optional.
 *
 * An agent that omitted either field on `POST /api/v1/journals` used to get a
 * 201 and a journal that silently contradicted what its owner asked for:
 * public when they wanted private, English mail for a German journal. All
 * three fields are now required, and `defaultLocale` — and each entry of
 * `locales` — is checked against the set this instance actually maintains
 * chrome and mail for, rather than storing whatever string arrives. `locales`
 * must also contain `defaultLocale`, the same rule `lib/config.ts` already
 * enforces on load, refused here instead of written to a file that would
 * load with a warning.
 */

let dir: string;
let caller = 0;

async function signupToken(email: string): Promise<string> {
  const { code } = await issueCode(SIGNUP_OWNER, email, "signup");
  const result = await verifyCode(SIGNUP_OWNER, email, code, "signup");
  if (!result.ok) throw new Error("could not mint a signup token");
  return result.token;
}

/** Each call from its own address — see test/signup-token.test.ts for why. */
function create(token: string, body: Record<string, unknown>) {
  caller += 1;
  return POST(
    new Request("https://example.test/api/v1/journals", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "x-forwarded-for": `203.0.113.${100 + caller}`,
      },
      body: JSON.stringify(body),
    }),
  );
}

const BASE = { title: "A journal", ownerName: "Robin Traveller", ownerNickname: "Robin" };

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-required-fields-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "auth.db")}`;
  process.env.SESSION_SECRET = "b263-test-secret-b263-test-secret";
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "T", url: "https://t.test" },
      users: { reserved: [] },
      features: {
        signup: { enabled: true },
        auth: { enabled: true },
        mail: { enabled: true, transport: "file" },
      },
    }),
  );
  // The dictionaries live beside the journals, under content/locales — needed
  // for the German welcome mail to render in German rather than falling back
  // to English.
  fs.symlinkSync(path.join(process.cwd(), "content", "locales"), path.join(dir, "locales"));
  clearConfigCache();
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

describe("visibility is required", () => {
  test("missing entirely is refused, and says which question to ask", async () => {
    const token = await signupToken("silent-visibility@example.test");
    const response = await create(token, { ...BASE, username: "silent-a", defaultLocale: "en" });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error?: string; message?: string };
    expect(body.error).toBe("invalid_request");
    expect(body.message).toMatch(/visibility is required/i);
    expect(body.message).toMatch(/ask/i);
    expect(getUser("silent-a")).toBeNull();
  });

  test("an unrecognised value is refused, distinctly from a missing one", async () => {
    const token = await signupToken("hidden-visibility@example.test");
    const response = await create(token, {
      ...BASE,
      username: "hidden-b",
      visibility: "hidden",
      defaultLocale: "en",
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { message?: string };
    expect(body.message).toMatch(/visibility must be "public" or "private"/i);
  });
});

describe("defaultLocale is required", () => {
  test("missing entirely is refused, and names the accepted codes", async () => {
    const token = await signupToken("silent-locale@example.test");
    const response = await create(token, { ...BASE, username: "silent-c", visibility: "public" });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error?: string; message?: string };
    expect(body.error).toBe("invalid_request");
    expect(body.message).toMatch(/defaultLocale is required/i);
    expect(getUser("silent-c")).toBeNull();
  });

  test("a language name rather than a code is refused, naming the accepted codes", async () => {
    const token = await signupToken("named-locale@example.test");
    const response = await create(token, {
      ...BASE,
      username: "silent-d",
      visibility: "public",
      defaultLocale: "Deutsch",
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { message?: string };
    expect(body.message).toContain("Deutsch");
    expect(body.message).toContain("de");
    expect(getUser("silent-d")).toBeNull();
  });

  test("each entry of locales is checked the same way", async () => {
    const token = await signupToken("bad-locales-list@example.test");
    const response = await create(token, {
      ...BASE,
      username: "silent-e",
      visibility: "public",
      defaultLocale: "en",
      locales: ["en", "German"],
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { message?: string };
    expect(body.message).toContain("German");
    expect(getUser("silent-e")).toBeNull();
  });
});

describe("locales is required", () => {
  test("missing entirely is refused, and names the question to ask", async () => {
    const token = await signupToken("silent-locales@example.test");
    const response = await create(token, {
      ...BASE,
      username: "silent-h",
      visibility: "public",
      defaultLocale: "en",
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error?: string; message?: string };
    expect(body.error).toBe("invalid_request");
    expect(body.message).toMatch(/locales is required/i);
    expect(getUser("silent-h")).toBeNull();
  });

  test("not containing defaultLocale is refused", async () => {
    const token = await signupToken("mismatched-locales@example.test");
    const response = await create(token, {
      ...BASE,
      username: "silent-i",
      visibility: "public",
      defaultLocale: "de",
      locales: ["en", "hu"],
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { message?: string };
    expect(body.message).toMatch(/locales must contain defaultLocale/i);
    expect(getUser("silent-i")).toBeNull();
  });
});

describe("what happens once both are answered", () => {
  test("a journal created private stays off the instance index", async () => {
    const token = await signupToken("private-owner@example.test");
    const response = await create(token, {
      ...BASE,
      username: "quiet-f",
      visibility: "private",
      defaultLocale: "en",
      locales: ["en"],
    });
    expect(response.status).toBe(201);
    expect(getUser("quiet-f")?.visibility).toBe("private");
    expect(listedUsernames()).not.toContain("quiet-f");
    expect(instanceDocumentation()).not.toContain("/quiet-f/");
  });

  test("a journal created with defaultLocale de gets a German welcome mail", async () => {
    const token = await signupToken("german-owner@example.test");
    const response = await create(token, {
      ...BASE,
      username: "reisender-g",
      visibility: "public",
      defaultLocale: "de",
      locales: ["de", "en"],
    });
    expect(response.status).toBe(201);

    const mailDir = path.join(dir, "reisender-g", "mail");
    const files = fs.readdirSync(mailDir).filter((f) => f.endsWith(".eml"));
    expect(files.length).toBeGreaterThan(0);
    const raw = fs.readFileSync(path.join(mailDir, files[0]), "utf8");
    const boundary = raw.match(/boundary="([^"]+)"/)?.[1];
    if (!boundary) throw new Error("no MIME boundary in the message");
    let body = "";
    for (const part of raw.split(`--${boundary}`)) {
      if (!/Content-Type: text\/plain/i.test(part)) continue;
      const encoded = part.split(/\r?\n\r?\n/).slice(1).join("\n");
      body = Buffer.from(encoded.replace(/\s/g, ""), "base64").toString("utf8");
      break;
    }
    // The German rendering of `welcome.title` — see test/journals.test.ts,
    // which asserts the same string against `sendWelcome` directly.
    expect(body).toContain("Dein Reisetagebuch ist bereit");
  });
});
