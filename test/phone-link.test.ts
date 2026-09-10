import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { POST as journalsPOST } from "@/app/api/v1/journals/route";
import { POST as phoneRequestPOST } from "@/app/api/auth/signup/phone/request/route";
import { POST as phoneVerifyPOST } from "@/app/api/auth/signup/phone/verify/route";
import { NO_JOURNAL, issueCode, verifyCode } from "@/lib/auth";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache, getUser } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { migrateToLatest } from "@/lib/db/migrate";
import { handleInboundMessage } from "@/lib/whatsapp/dispatch";
import type { InboundMessage } from "@/lib/whatsapp/inbound";

/**
 * B1234 — proving a number by receiving a message from it. The wa.me link's
 * prefilled text carries a one-time token; the webhook seeing it arrive from
 * a number is the proof; nobody types a code.
 */

const SENDER = "41790000042";

let dir: string;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-b1234-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATA_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "auth.db")}`;
  process.env.SESSION_SECRET = "b1234-test-secret-b1234-test-secret";
  process.env.WHATSAPP_APP_SECRET = "test-secret";
  process.env.WHATSAPP_VERIFY_TOKEN = "test-token";
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "T", url: "https://t.test" },
      users: { reserved: [] },
      features: {
        auth: { enabled: true },
        signup: { enabled: true, phoneBackend: "whatsapp-inbound" },
        whatsapp: { enabled: true, backend: "dry-run", number: "+41 79 111 22 33" },
        whatsappInbound: { enabled: true },
      },
    }),
  );
  clearConfigCache();
  clearUserCache();
  await migrateToLatest(await getDatabase());
});

afterEach(async () => {
  await closeDatabase();
  delete process.env.CONTENT_DIR;
  delete process.env.DATA_DIR;
  delete process.env.DATABASE_URL;
  delete process.env.SESSION_SECRET;
  delete process.env.WHATSAPP_APP_SECRET;
  delete process.env.WHATSAPP_VERIFY_TOKEN;
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

function post(route: (r: Request) => Promise<Response>, token: string, body: unknown) {
  return route(
    new Request("https://t.test/x", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    }),
  );
}

function inbound(body: string, from = SENDER): InboundMessage {
  return { kind: "text", id: `wamid.${Math.random()}`, from, timestamp: "1", body };
}

/** Every dry-run reply written anywhere under the content root. */
function replies(): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const f of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, f.name);
      if (f.isDirectory()) walk(p);
      else if (f.name.endsWith(".json") && p.includes("whatsapp-repl")) out.push(fs.readFileSync(p, "utf8"));
    }
  };
  walk(dir);
  return out;
}

describe("the inbound phone proof", () => {
  test("link, message, poll, journal — end to end, and nobody typed a code", async () => {
    const token = await signupToken("b1234@example.test");

    const requested = await post(phoneRequestPOST, token, {});
    expect(requested.status).toBe(202);
    const { mode, id, link, text } = (await requested.json()) as Record<string, string>;
    expect(mode).toBe("whatsapp-inbound");
    expect(link).toContain("https://wa.me/41791112233?text=");
    expect(text).toMatch(/FS-[2-9A-HJKMNP-Z]{8}/);

    // Still pending before anybody sends anything.
    const early = await post(phoneVerifyPOST, token, { id });
    expect(((await early.json()) as { status: string }).status).toBe("pending");

    // The person taps send; the webhook sees the token arrive from a number.
    await handleInboundMessage(inbound(text));
    expect(replies().some((r) => r.includes("confirmed"))).toBe(true);

    const polled = await post(phoneVerifyPOST, token, { id });
    expect(polled.status).toBe(200);
    const proof = (await polled.json()) as { ok: boolean; tel: string };
    expect(proof.ok).toBe(true);
    expect(proof.tel).toBe(SENDER);

    // The proof rides the signup token into the create.
    const created = await post(journalsPOST, token, {
      title: "Ours",
      username: "b1234-proof",
      ownerName: "B Twelve",
      ownerNickname: "B",
      visibility: "public",
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
    });
    expect(created.status).toBe(201);
    const user = getUser("b1234-proof");
    expect(user?.owner.tel).toBe(SENDER);
    expect(user?.owner.telProvenAt).toBeTruthy();
  });

  test("an invented token is told it has expired, and proves nothing", async () => {
    const token = await signupToken("b1234b@example.test");
    const requested = await post(phoneRequestPOST, token, {});
    const { id } = (await requested.json()) as Record<string, string>;

    await handleInboundMessage(inbound("Fernscout signup FS-23456789 - hello"));
    expect(replies().some((r) => r.includes("expired"))).toBe(true);

    const polled = await post(phoneVerifyPOST, token, { id });
    expect(((await polled.json()) as { status: string }).status).toBe("pending");
  });

  test("a proof is bound to the session that asked for it", async () => {
    const token = await signupToken("b1234c@example.test");
    const other = await signupToken("b1234d@example.test");

    const requested = await post(phoneRequestPOST, token, {});
    const { id, text } = (await requested.json()) as Record<string, string>;
    await handleInboundMessage(inbound(text));

    // The other session polling the same id gets nothing.
    const stolen = await post(phoneVerifyPOST, other, { id });
    expect(((await stolen.json()) as { status: string }).status).toBe("expired");

    // The rightful session still collects.
    const polled = await post(phoneVerifyPOST, token, { id });
    expect(((await polled.json()) as { ok: boolean }).ok).toBe(true);
  });

  test("a second link supersedes the first, and a used token cannot be replayed", async () => {
    const token = await signupToken("b1234e@example.test");
    const first = (await (await post(phoneRequestPOST, token, {})).json()) as Record<string, string>;
    const second = (await (await post(phoneRequestPOST, token, {})).json()) as Record<string, string>;

    // The superseded token reads as expired.
    await handleInboundMessage(inbound(first.text));
    expect((await (await post(phoneVerifyPOST, token, { id: first.id })).json() as { status: string }).status).toBe(
      "expired",
    );

    // The live one works once, and its message replayed proves nothing new.
    await handleInboundMessage(inbound(second.text));
    const polled = (await (await post(phoneVerifyPOST, token, { id: second.id })).json()) as { ok?: boolean };
    expect(polled.ok).toBe(true);
    await handleInboundMessage(inbound(second.text, "41790000099"));
    expect(replies().filter((r) => r.includes("expired")).length).toBeGreaterThan(0);
  });
});
