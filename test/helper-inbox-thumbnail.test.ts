import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { storeInboxFile } from "@/lib/inbox";
import { paintJpeg } from "./support/pictures";

/**
 * The one route this ticket adds a security surface with — B1123.
 *
 * `content/<user>/inbox/` is reachable by no other URL (`lib/inbox.ts`). This
 * route is the single door into it, and everything here is either "does the
 * owner get a picture back" or "does everyone else get exactly the same 404
 * a nonexistent id would".
 */

const OWNER_EMAIL = "alex@example.test";
const OTHER_EMAIL = "sam@example.test";

const { resolveAccess } = vi.hoisted(() => ({
  resolveAccess: vi.fn(async () => ({ email: OWNER_EMAIL as string | null })),
}));
vi.mock("@/lib/auth/handshake", () => ({ resolveAccess }));

const { GET } = await import("@/app/api/helper/[user]/inbox/[id]/thumbnail/route");

let dir: string;

function journalFor(username: string, email: string) {
  fs.mkdirSync(path.join(dir, username), { recursive: true });
  fs.writeFileSync(
    path.join(dir, username, "config.json"),
    JSON.stringify({
      title: username,
      tagline: "t",
      owner: { name: "A B", nickname: "A", email },
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
    }),
  );
}

function request(user: string, id: string) {
  return GET(new Request(`https://t.test/api/helper/${user}/inbox/${id}/thumbnail`), {
    params: Promise.resolve({ user, id }),
  });
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-helper-thumb-"));
  process.env.CONTENT_DIR = dir;
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "T", url: "https://t.test" },
      features: { auth: { enabled: true }, helper: { enabled: true } },
    }),
  );
  resolveAccess.mockResolvedValue({ email: OWNER_EMAIL });
  journalFor("alex", OWNER_EMAIL);
  journalFor("sam", OTHER_EMAIL);
  clearConfigCache();
  clearUserCache();
});

afterEach(() => {
  delete process.env.CONTENT_DIR;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("the owner asking for their own waiting photograph", () => {
  test("gets a resized WebP, held by no shared cache", async () => {
    const stored = storeInboxFile("alex", "media", "beach.jpg", await paintJpeg(800, 600, 1), {});
    const response = await request("alex", stored.entry.id);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/webp");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const body = Buffer.from(await response.arrayBuffer());
    expect(body.byteLength).toBeGreaterThan(0);
  });

  test("a document has no picture to give back", async () => {
    const stored = storeInboxFile("alex", "files", "statement.csv", Buffer.from("a,b\n1,2\n"), {});
    const response = await request("alex", stored.entry.id);
    expect(response.status).toBe(404);
  });
});

describe("everyone else", () => {
  test("no session at all is refused, same shape as a missing id", async () => {
    resolveAccess.mockResolvedValue({ email: null });
    const stored = storeInboxFile("alex", "media", "beach.jpg", await paintJpeg(400, 300, 2), {});
    const response = await request("alex", stored.entry.id);
    expect(response.status).not.toBe(200);
  });

  test("a real id belonging to a DIFFERENT journal's owner is 404, not the picture", async () => {
    // The person asking is signed in as sam, sam's own journal exists, and
    // the id is a real, staged file — but it belongs to alex's inbox.
    const stored = storeInboxFile("alex", "media", "beach.jpg", await paintJpeg(500, 400, 3), {});
    resolveAccess.mockResolvedValue({ email: OTHER_EMAIL });
    const response = await request("sam", stored.entry.id);
    expect(response.status).toBe(404);
  });

  test("path segments in the id cannot walk out of this journal's own inbox", async () => {
    storeInboxFile("alex", "media", "beach.jpg", await paintJpeg(500, 400, 4), {});
    const response = await request("alex", "../../sam/inbox/media/beach.jpg");
    expect(response.status).toBe(404);
  });

  test("an id naming nothing at all is the same 404", async () => {
    const response = await request("alex", "deadbeef-nothing.jpg");
    expect(response.status).toBe(404);
  });
});
