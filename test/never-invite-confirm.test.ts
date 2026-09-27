import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache, getUser } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { migrateToLatest } from "@/lib/db/migrate";
import type { Mail } from "@/lib/mail/types";

/**
 * Security review M2 — `invite.mail`'s `List-Unsubscribe` used to repeat the
 * visible footer link, `/x/<token>` (`app/x/[token]/page.tsx`, a page with
 * no POST handler at all). A mail client's own one-click button sends that
 * header's URL a bare POST, which a page route cannot answer — so the
 * "unsubscribe" a scanner or a mail client pressed silently did nothing.
 * This proves the fix end to end: the header now names
 * `/x/<token>/confirm`, and POSTing exactly that URL is what
 * `isInviteSuppressed` sees afterwards.
 */

const sent: Mail[] = [];
vi.mock("@/lib/mail", () => ({
  sendMail: vi.fn(async (mail: Mail) => {
    sent.push(mail);
    return { transport: "test", reference: "test" };
  }),
}));

const USERNAME = "hosttrip";
const OWNER_EMAIL = "owner@example.test";
const READER_EMAIL = "reader@example.test";

let dir: string;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-never-invite-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "db.sqlite")}`;
  process.env.SESSION_SECRET = "18".repeat(32);
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "R", url: "https://example.test" },
      users: { reserved: [] },
      features: { mail: { enabled: true } },
    }),
  );
  fs.mkdirSync(path.join(dir, USERNAME), { recursive: true });
  fs.writeFileSync(
    path.join(dir, USERNAME, "config.json"),
    JSON.stringify({
      title: "Host trip",
      owner: { name: "Host", nickname: "Host", email: OWNER_EMAIL },
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
    }),
  );
  clearConfigCache();
  clearUserCache();
  await migrateToLatest(await getDatabase());
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(async () => {
  await closeDatabase();
  delete process.env.CONTENT_DIR;
  delete process.env.DATABASE_URL;
  delete process.env.SESSION_SECRET;
  clearConfigCache();
  clearUserCache();
  fs.rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
  sent.length = 0;
});

test("the List-Unsubscribe header names /confirm, and posting it suppresses the address", async () => {
  const { sendInviteMail } = await import("@/lib/contacts/mail");
  const { isInviteSuppressed, isNeverInviteToken } = await import("@/lib/contacts/suppressions");
  const user = getUser(USERNAME)!;

  await sendInviteMail(USERNAME, user, {
    email: READER_EMAIL,
    locale: "en",
    kind: "guest",
    url: "https://example.test/hosttrip/w/abc123",
  });
  expect(sent).toHaveLength(1);

  const header = sent[0].headers?.["List-Unsubscribe"];
  expect(header).toBeTruthy();
  const listedUrl = header!.slice(1, -1); // strip the <angle brackets>
  expect(listedUrl).toMatch(/\/x\/[^/]+\/confirm$/);

  // The visible footer link is a different, page-only URL — the fix's other
  // half: a scanner or a mail client following the header must not land on
  // the same address a person reads before deciding anything.
  const footerText = sent[0].text;
  expect(footerText).not.toContain(listedUrl);
  expect(footerText).toMatch(/https:\/\/example\.test\/x\/[^/\s]+(?!\/confirm)/);

  const token = listedUrl.match(/\/x\/([^/]+)\/confirm$/)![1];
  expect(isNeverInviteToken(token)).toBe(true);
  expect(await isInviteSuppressed(READER_EMAIL)).toBe(false);

  const { POST } = await import("@/app/x/[token]/confirm/route");
  const response = await POST(new Request("https://example.test/x/whatever/confirm", { method: "POST" }), {
    params: Promise.resolve({ token }),
  });
  expect(response.status).toBe(200);
  expect(await isInviteSuppressed(READER_EMAIL)).toBe(true);
});

describe("without SESSION_SECRET there is no never-invite door (wave 2 review, L1)", () => {
  test("the confirm route refuses, since an unkeyed hash is computable from an address", async () => {
    delete process.env.SESSION_SECRET;
    const { POST } = await import("@/app/x/[token]/confirm/route");
    const token = "a".repeat(64);
    const response = await POST(new Request(`https://example.test/x/${token}/confirm`, { method: "POST" }), {
      params: Promise.resolve({ token }),
    } as never);
    expect(response.status).toBe(404);
  });
});
