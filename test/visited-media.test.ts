import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";

/**
 * B2914 — the visited photograph is served only to readers its entry's own
 * visibility admits, through the same predicates trips use. The reader is
 * decided by the two session lookups `mayReadTrip` makes, mocked here.
 */

const who = vi.hoisted(() => ({ owner: false, guest: false, close: false }));
vi.mock("@/lib/contacts/session", () => ({
  isOwner: async () => who.owner,
  journalReader: async () => ({ email: null, contact: null, guest: who.guest, close: who.close }),
}));

const OWNER = "test-visited-media";
let dir: string;

const ctx = (code: string, file: string) => ({ params: Promise.resolve({ user: OWNER, code, file }) });
const asReader = (r: Partial<typeof who>) => Object.assign(who, { owner: false, guest: false, close: false }, r);

async function seed(visibility: "private" | "guest" | "public"): Promise<string> {
  const { addVisit, putVisitPhoto, getVisit } = await import("@/lib/visited");
  addVisit(OWNER, { country: "NO", visibility });
  const bytes = await sharp({ create: { width: 120, height: 80, channels: 3, background: "#aa5522" } }).jpeg().toBuffer();
  await putVisitPhoto(OWNER, "NO", { filename: "x.jpg", bytes });
  return getVisit(OWNER, "NO")!.photo!;
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-visited-media-"));
  process.env.CONTENT_DIR = dir;
  fs.writeFileSync(path.join(dir, "config.json"), JSON.stringify({ site: { name: "R", url: "https://example.test", defaultUser: OWNER }, users: { reserved: [] } }));
  fs.mkdirSync(path.join(dir, OWNER, "trips"), { recursive: true });
  fs.writeFileSync(path.join(dir, OWNER, "config.json"), JSON.stringify({ title: "Test", owner: { name: "Robin Traveller", nickname: "Robin", email: "o@example.test" }, defaultLocale: "en", locales: ["en"] }));
  clearConfigCache();
  clearUserCache();
});

afterEach(() => {
  delete process.env.CONTENT_DIR;
  clearConfigCache();
  clearUserCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("visited photograph serving", () => {
  test.each([
    ["private", { owner: 200, close: 200, guest: 404, stranger: 404 }],
    ["guest", { owner: 200, close: 200, guest: 200, stranger: 404 }],
    ["public", { owner: 200, close: 200, guest: 200, stranger: 200 }],
  ] as const)("a %s entry's photograph", async (visibility, expected) => {
    const { GET } = await import("@/app/at/[user]/visited-media/[code]/[file]/route");
    const file = await seed(visibility);
    const readers = {
      owner: { owner: true },
      close: { guest: true, close: true },
      guest: { guest: true },
      stranger: {},
    } as const;
    for (const [name, r] of Object.entries(readers)) {
      asReader(r);
      const res = await GET(new Request(`https://example.test/at/${OWNER}/visited-media/NO/${file}`), ctx("NO", file));
      expect(res.status, name).toBe(expected[name as keyof typeof expected]);
      if (res.status === 200) expect(res.headers.get("content-type")).toBe("image/jpeg");
    }
  });

  test("only the file the entry names is served, and a path never escapes", async () => {
    const { GET } = await import("@/app/at/[user]/visited-media/[code]/[file]/route");
    const file = await seed("public");
    asReader({});
    const get = (code: string, f: string) => GET(new Request("https://example.test/x"), ctx(code, f));
    expect((await get("NO", "0".repeat(32) + ".jpg")).status).toBe(404);
    expect((await get("NO", "..%2F..%2Fconfig.json")).status).toBe(404);
    expect((await get("../NO", file)).status).toBe(404);
    expect((await get("GR", file)).status).toBe(404);
    expect((await get("NO", file)).status).toBe(200);
    expect((await GET(new Request("https://example.test/x?w=320"), ctx("NO", file))).headers.get("content-type")).toBe("image/webp");
  });
});
