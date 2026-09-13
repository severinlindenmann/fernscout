import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { migrateToLatest } from "@/lib/db/migrate";
import { createTrip } from "@/lib/tripWrite";

/**
 * This route's day-scoped upload — B683's storage half.
 *
 * The two-phase original upload B683 also built here (`phase=original`,
 * `attachOriginal`) is gone: B1435 found no caller left for it once the
 * step wizard that needed it retired (B1239 deleted the browser half,
 * `components/uploadQueue.ts`), and the inbox-first redesign
 * (`components/HelperRoom.tsx`'s `UploadPanel`) sends a photograph's
 * untouched bytes in one request instead, so the phone-original problem it
 * solved is already solved a different way. What remains asserted here: a
 * photograph lands through `storeUploads` with a `src`, and a file which is
 * not media is kept in the inbox rather than refused.
 */

const OWNER_EMAIL = "alex@example.test";

const { resolveAccess } = vi.hoisted(() => ({
  resolveAccess: vi.fn(async () => ({ email: OWNER_EMAIL as string | null })),
}));
vi.mock("@/lib/auth/handshake", () => ({ resolveAccess }));

const { POST: dayRoute } = await import("@/app/api/helper/[user]/day/route");
const { GET, POST } = await import("@/app/api/helper/[user]/day/media/route");

let dir: string;
const params = { params: Promise.resolve({ user: "alex" }) };

function image(width: number, height: number, format: "jpeg" | "png"): Promise<Buffer> {
  const canvas = sharp({
    create: { width, height, channels: 3, background: { r: 30, g: 120, b: 90 } },
  });
  return (format === "png" ? canvas.png() : canvas.jpeg()).toBuffer();
}

async function upload(fields: Record<string, string>, filename: string, bytes: Buffer) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  form.set("file", new File([new Uint8Array(bytes)], filename));
  const response = await POST(
    new Request("https://t.test/api/helper/alex/day/media", { method: "POST", body: form }),
    params,
  );
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-wizard-upload-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "test.db")}`;
  process.env.SESSION_SECRET = "agent-wizard-upload-secret-b683";
  resolveAccess.mockResolvedValue({ email: OWNER_EMAIL });
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "T", url: "https://t.test" },
      features: { auth: { enabled: true } },
    }),
  );
  fs.mkdirSync(path.join(dir, "alex"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "alex", "config.json"),
    JSON.stringify({
      title: "Alex",
      tagline: "t",
      owner: { name: "A B", nickname: "A", email: OWNER_EMAIL },
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
    }),
  );
  clearConfigCache();
  clearUserCache();
  await migrateToLatest(await getDatabase());

  const created = createTrip("alex", { id: "a-trip", title: "A trip", start: "2026-05-01", end: "2026-05-31" });
  if (!created.ok) throw new Error(`trip fixture failed: ${created.message}`);
});

afterEach(async () => {
  await closeDatabase();
  delete process.env.CONTENT_DIR;
  delete process.env.DATABASE_URL;
  fs.rmSync(dir, { recursive: true, force: true });
});

async function startDay(): Promise<string> {
  const response = await dayRoute(
    new Request("https://t.test/api/helper/alex/day", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        trip: "a-trip",
        date: "2026-05-04",
        answers: {
          costs: "none",
          coordinates: "unknown",
          time: "none",
          transportMode: "none",
          tags: "none",
          visibility: "none",
        },
      }),
    }),
    params,
  );
  const body = (await response.json()) as { slug: string };
  return body.slug;
}

const originals = (slug: string) => path.join(dir, "alex", "trips", "a-trip", "originals", slug);

describe("this route's day-scoped upload", () => {
  test("a photograph lands through storeUploads, with a src the caller can use", async () => {
    const slug = await startDay();

    const web = await upload(
      { trip: "a-trip", day: slug },
      "IMG_0001.jpg",
      await image(2000, 1333, "jpeg"),
    );
    expect(web.status).toBe(201);
    expect(web.body.stored).toBe(1);
    expect(String(web.body.src)).toBe(`/media/a-trip/${slug}/01.jpg`);
    // `storeUploads` keeps the upload as the original too — this route sends
    // no separate one.
    expect(fs.readdirSync(originals(slug))).toEqual(["01.jpg"]);

    const { getEntryBySlug } = await import("@/lib/entries");
    const entry = getEntryBySlug("alex/a-trip", slug, { includeDrafts: true });
    expect(entry?.gallery.map((item) => item.src)).toEqual([`/alex/media/a-trip/${slug}/01.jpg`]);
  });

  test("a file that is not media goes to the inbox instead of being refused", async () => {
    const slug = await startDay();
    const csv = Buffer.from("date,amount\n2026-05-04,12.50\n");
    const stored = await upload({ trip: "a-trip", day: slug }, "bank.csv", csv);
    expect(stored.status).toBe(201);
    expect(stored.body.existed).toBe(false);
    const id = String(stored.body.inbox);
    expect(fs.existsSync(path.join(dir, "alex", "inbox", "files", id))).toBe(true);

    // The same bytes again are the same row, not a second copy — which is
    // what makes a resumed queue safe to re-send from.
    const again = await upload({ trip: "a-trip", day: slug }, "bank.csv", csv);
    expect(again.body.inbox).toBe(id);
    expect(again.body.existed).toBe(true);

    // Something nothing here reads at all is still a refusal, with a reason.
    const odd = await upload({ trip: "a-trip", day: slug }, "notes.docx", csv);
    expect(odd.status).toBe(400);
    expect(odd.body.error).toBe("unknown_file_type");
  });

  test("B1657: a non-photograph upload is refused once the journal is at its storage ceiling", async () => {
    const slug = await startDay();

    // Shrink the ceiling to well under what is already on disk (the trip
    // fixture, the day itself) so any further write is over it.
    fs.writeFileSync(
      path.join(dir, "config.json"),
      JSON.stringify({
        site: { name: "T", url: "https://t.test" },
        features: { auth: { enabled: true } },
        media: { perUserBytes: 1 },
      }),
    );
    clearConfigCache();

    const csv = Buffer.from("date,amount\n2026-05-04,12.50\n");
    const refused = await upload({ trip: "a-trip", day: slug }, "bank.csv", csv);
    expect(refused.status).toBe(400);
    expect(refused.body.error).toBe("storage_full");
    expect(fs.existsSync(path.join(dir, "alex", "inbox", "files"))).toBe(false);
  });

  test("how much room is left is answerable before the queue starts", async () => {
    const response = await GET(
      new Request("https://t.test/api/helper/alex/day/media"),
      params,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, number>;
    expect(body.remainingBytes).toBeGreaterThan(0);
    expect(body.itemsPerDay).toBeGreaterThan(0);

    resolveAccess.mockResolvedValue({ email: "someone@example.test" });
    const refused = await GET(new Request("https://t.test/api/helper/alex/day/media"), params);
    expect(refused.status).toBe(404);
  });
});
