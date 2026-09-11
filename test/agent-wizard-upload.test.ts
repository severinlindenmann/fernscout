import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { migrateToLatest } from "@/lib/db/migrate";
import { issueCode, verifyCode } from "@/lib/auth";
import { POST as createTripRoute } from "@/app/api/v1/[user]/trips/route";

/**
 * The two-phase upload, from the server's side — B683.
 *
 * The browser half (the downscale, the IndexedDB queue, the backoff) lived in
 * `components/uploadQueue.ts`, checked by driving a phone at 390px — the only
 * check that ever meant anything for it. That component was the retired
 * step-wizard's own and was deleted with it (B1239; see B1435 for whether
 * anything still drives this route's original-replaces-web-copy path from a
 * browser at all). What is asserted here is the server half regardless: that
 * a web copy comes back with a `src`, that the original sent afterwards lands
 * in `originals/` under the same stem and *replaces* the web copy rather than
 * sitting beside it — one photograph, one original, one lot of bytes against
 * the ceiling — and that a file which is not media is kept in the inbox
 * rather than refused.
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

  const { code } = await issueCode("alex", OWNER_EMAIL, "agent");
  const verified = await verifyCode("alex", OWNER_EMAIL, code, "agent");
  if (!verified.ok) throw new Error("no token");
  await createTripRoute(
    new Request("https://t.test/api/v1/alex/trips", {
      method: "POST",
      headers: { authorization: `Bearer ${verified.token}`, "content-type": "application/json" },
      body: JSON.stringify({ id: "a-trip", title: "A trip", start: "2026-05-01", end: "2026-05-31" }),
    }),
    params,
  );
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
        answers: { costs: "none", coordinates: "unknown" },
      }),
    }),
    params,
  );
  const body = (await response.json()) as { slug: string };
  return body.slug;
}

const originals = (slug: string) => path.join(dir, "alex", "trips", "a-trip", "originals", slug);

describe("the wizard's two-phase upload", () => {
  test("the web copy lands, and the original replaces it under the same stem", async () => {
    const slug = await startDay();

    // Phase one: the 2000px copy the browser made. The response has to carry
    // the item's `src`, because that is the only thing phase two can aim at.
    const web = await upload(
      { trip: "a-trip", day: slug, phase: "web" },
      "IMG_0001.jpg",
      await image(2000, 1333, "jpeg"),
    );
    expect(web.status).toBe(201);
    expect(web.body.stored).toBe(1);
    const src = String(web.body.src);
    expect(src).toBe(`/media/a-trip/${slug}/01.jpg`);
    // `storeUploads` kept the copy as the original, because it has no way to
    // know a bigger one is on its way.
    expect(fs.readdirSync(originals(slug))).toEqual(["01.jpg"]);

    // Phase two: the untouched file, against that item.
    const full = await image(3600, 2400, "png");
    const attached = await upload(
      { trip: "a-trip", phase: "original", src },
      "IMG_0001.png",
      full,
    );
    expect(attached.status).toBe(201);
    expect(attached.body.original).toBe("01.png");

    // One photograph, one original: the web copy is gone rather than lying
    // beside it, so the journal is not charged twice and the photobook has
    // exactly one thing to print from.
    expect(fs.readdirSync(originals(slug))).toEqual(["01.png"]);
    expect(fs.statSync(path.join(originals(slug), "01.png")).size).toBe(full.byteLength);

    // The day itself is unchanged by phase two — it still holds one item, and
    // it still points at the derivative a browser reads.
    const { getEntryBySlug } = await import("@/lib/entries");
    const entry = getEntryBySlug("alex/a-trip", slug, { includeDrafts: true });
    expect(entry?.gallery.map((item) => item.src)).toEqual([`/alex/media/a-trip/${slug}/01.jpg`]);
  });

  test("an original aimed at nothing is refused rather than written", async () => {
    const slug = await startDay();
    await upload({ trip: "a-trip", day: slug, phase: "web" }, "a.jpg", await image(800, 600, "jpeg"));

    for (const src of [
      `/media/a-trip/${slug}/99.jpg`, // No such photograph.
      `/media/other-trip/${slug}/01.jpg`, // Another trip's.
      `/media/a-trip/../../../etc/01.jpg`, // Out of the tree entirely.
    ]) {
      const refused = await upload(
        { trip: "a-trip", phase: "original", src },
        "a.png",
        await image(400, 300, "png"),
      );
      expect(refused.status).toBe(400);
    }
    expect(fs.readdirSync(originals(slug))).toEqual(["01.jpg"]);
  });

  test("a file that is not media goes to the inbox instead of being refused", async () => {
    const slug = await startDay();
    const csv = Buffer.from("date,amount\n2026-05-04,12.50\n");
    const stored = await upload({ trip: "a-trip", day: slug, phase: "web" }, "bank.csv", csv);
    expect(stored.status).toBe(201);
    expect(stored.body.existed).toBe(false);
    const id = String(stored.body.inbox);
    expect(fs.existsSync(path.join(dir, "alex", "inbox", "files", id))).toBe(true);

    // The same bytes again are the same row, not a second copy — which is
    // what makes a resumed queue safe to re-send from.
    const again = await upload({ trip: "a-trip", day: slug, phase: "web" }, "bank.csv", csv);
    expect(again.body.inbox).toBe(id);
    expect(again.body.existed).toBe(true);

    // Something nothing here reads at all is still a refusal, with a reason.
    const odd = await upload({ trip: "a-trip", day: slug }, "notes.docx", csv);
    expect(odd.status).toBe(400);
    expect(odd.body.error).toBe("unknown_file_type");
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
