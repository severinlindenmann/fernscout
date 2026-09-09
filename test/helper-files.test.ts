import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { migrateToLatest } from "@/lib/db/migrate";
import { AS_AUTHOR, getEntryBySlug } from "@/lib/entries";
import { tripMediaDir } from "@/lib/media";
import { listInbox, storeInboxFile } from "@/lib/inbox";
import { runTool } from "@/lib/helper/tools";
import { paintJpeg } from "./support/pictures";

/**
 * Three capabilities added to the files area — `inbox` (read), `remove_photo`
 * and `discard_file` (both write, `confirm`).
 *
 * `remove_photo` is the one that matters: `detachGallery` deletes the
 * derivative and the kept original from disk, so the whole point of this file
 * is proving the card names the *right* photograph before the button, and
 * that a press cannot be aimed at a different one than the card showed.
 */

const OWNER_EMAIL = "alex@example.test";

const { resolveAccess } = vi.hoisted(() => ({
  resolveAccess: vi.fn(async () => ({ email: OWNER_EMAIL as string | null })),
}));
vi.mock("@/lib/auth/handshake", () => ({ resolveAccess }));

const { POST: removePhoto } = await import("@/app/api/helper/[user]/day/remove-photo/route");
const { POST: discardFile } = await import("@/app/api/helper/[user]/inbox/discard/route");

const TRIP = "a-trip";
const REF = `alex/${TRIP}`;
const SLUG = "the-pass";
let dir: string;
const params = { params: Promise.resolve({ user: "alex" }) };
const say = (key: string, vars?: Record<string, string>) =>
  vars ? `${key} ${Object.values(vars).join(" ")}` : key;

function post(route: (request: Request, context: typeof params) => Promise<Response>, url: string, payload: unknown) {
  return route(
    new Request(`https://t.test${url}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }),
    params,
  );
}

async function rows() {
  const { db } = (await getDatabase())!;
  return db.selectFrom("helper_sessions").selectAll().where("kind", "=", "press").execute();
}

/** Two photographs, real files on disk, exactly as an upload leaves them —
 *  the same fixture `test/helper-photo-removal.test.ts` builds. */
async function writeDay() {
  const media = tripMediaDir(REF);
  fs.mkdirSync(path.join(media, SLUG), { recursive: true });
  const gallery: string[] = [];
  for (const name of ["01.jpg", "02.jpg"]) {
    fs.writeFileSync(path.join(media, SLUG, name), await paintJpeg(400, 300, 1));
    gallery.push(
      `  - src: "/media/${TRIP}/${SLUG}/${name}"\n    type: image\n    width: 400\n    height: 300`,
    );
  }
  const tripDir = path.join(dir, "alex", "trips", TRIP);
  fs.mkdirSync(path.join(tripDir, "entries"), { recursive: true });
  fs.writeFileSync(
    path.join(tripDir, "entries", `2026-05-04-${SLUG}.md`),
    ["---", 'title: "The pass"', 'date: "2026-05-04"', "status: draft", "gallery:", ...gallery, "---", "", "Words.", ""].join("\n"),
  );
  fs.writeFileSync(
    path.join(tripDir, "trip.md"),
    ["---", `id: ${TRIP}`, 'title: "Over the pass"', 'start: "2026-05-01"', 'end: "2026-05-31"', "visibility: public", "---", "", "Trip.", ""].join("\n"),
  );
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-helper-files-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "test.db")}`;
  process.env.SESSION_SECRET = "helper-files-secret-b1042";
  resolveAccess.mockResolvedValue({ email: OWNER_EMAIL });

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
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "T", url: "https://t.test" },
      features: { auth: { enabled: true }, helper: { enabled: true } },
    }),
  );
  clearConfigCache();
  clearUserCache();
  await migrateToLatest(await getDatabase());
  await writeDay();
});

afterEach(async () => {
  await closeDatabase();
  delete process.env.CONTENT_DIR;
  delete process.env.DATABASE_URL;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("inbox — what is staged, told rather than shown as a second pane", () => {
  test("names each file, roughly how big, and never a fetchable path", async () => {
    await storeInboxFile("alex", "media", "harbour.jpg", await paintJpeg(400, 300, 3), {});
    await storeInboxFile("alex", "files", "statement.csv", Buffer.from("date,amount\n"), {});

    const ran = await runTool("alex", "inbox", {}, say, "2026-05-05");
    expect(ran.blocks).toHaveLength(1);
    const block = ran.blocks[0] as { shape: string; files: { id: string; name: string }[] };
    expect(block.shape).toBe("files");
    expect(block.files).toHaveLength(2);
    const names = block.files.map((f) => f.name);
    expect(names.some((n) => n.includes("harbour.jpg") && n.includes("photograph"))).toBe(true);
    expect(names.some((n) => n.includes("statement.csv") && n.includes("file"))).toBe(true);
    // No path or URL in what is shown — only the filename, the kind and a
    // rough size. The id is a hash of the bytes, not a route.
    for (const file of block.files) {
      expect(file.name).not.toMatch(/\//);
      expect(file.id).not.toMatch(/\//);
    }
  });

  test("nothing staged draws nothing", async () => {
    const ran = await runTool("alex", "inbox", {}, say, "2026-05-05");
    expect(ran.blocks).toEqual([]);
  });
});

describe("remove_photo — the one irreversible thing here", () => {
  function srcOf(name: string) {
    return getEntryBySlug(REF, SLUG, AS_AUTHOR)?.gallery.find((item) => item.src.endsWith(name))!.src;
  }

  test("the proposal carries a preview of the photograph it is about", async () => {
    const src = srcOf("02.jpg");
    const ran = await runTool(
      "alex",
      "remove_photo",
      {},
      say,
      "2026-05-05",
      [`photo:${SLUG}:${src}`],
    );
    expect(ran.proposal?.tool).toBe("remove_photo");
    expect(ran.proposal?.endpoint).toBe("/api/helper/alex/day/remove-photo");
    expect(ran.blocks.map((b) => b.shape)).toEqual(["preview", "confirm"]);
    const preview = ran.blocks[0] as { lines: string[] };
    expect(preview.lines).toEqual(["2026-05-04 — The pass", src]);
    expect(ran.proposal?.fields).toEqual([
      { name: "trip", value: TRIP },
      { name: "slug", value: SLUG },
      { name: "src", value: src },
    ]);
    // Nothing has happened yet.
    expect(getEntryBySlug(REF, SLUG, AS_AUTHOR)?.gallery).toHaveLength(2);
  });

  test("the press removes exactly the photograph the card showed", async () => {
    const src = srcOf("02.jpg");
    const ran = await runTool("alex", "remove_photo", {}, say, "2026-05-05", [`photo:${SLUG}:${src}`]);
    const args = ran.proposal!.arguments;
    const response = await post(removePhoto, "/api/helper/alex/day/remove-photo", args);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; removed: string[] };
    expect(body.ok).toBe(true);
    expect(body.removed).toEqual([src]);

    const entry = getEntryBySlug(REF, SLUG, AS_AUTHOR);
    expect(entry?.gallery.map((i) => i.src)).toEqual([srcOf("01.jpg")]);
    expect(fs.existsSync(path.join(tripMediaDir(REF), SLUG, "02.jpg"))).toBe(false);
    expect(fs.existsSync(path.join(tripMediaDir(REF), SLUG, "01.jpg"))).toBe(true);
  });

  /**
   * **The worst thing this area could ship** — a press aimed at one
   * photograph that removes another. Pressing with a `src` the day does not
   * carry is refused outright, never quietly matched to the nearest thing.
   */
  test("pressing with a src the day does not carry is refused, and nothing is removed", async () => {
    const one = srcOf("01.jpg");
    const two = srcOf("02.jpg");
    const ran = await runTool("alex", "remove_photo", {}, say, "2026-05-05", [`photo:${SLUG}:${one}`]);
    const tampered = { ...ran.proposal!.arguments, src: `${two}-not-a-real-file.jpg` };
    const response = await post(removePhoto, "/api/helper/alex/day/remove-photo", tampered);
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toBe("unknown_media");

    const entry = getEntryBySlug(REF, SLUG, AS_AUTHOR);
    expect(entry?.gallery.map((i) => i.src).sort()).toEqual([one, two].sort());
    expect(fs.existsSync(path.join(tripMediaDir(REF), SLUG, "01.jpg"))).toBe(true);
    expect(fs.existsSync(path.join(tripMediaDir(REF), SLUG, "02.jpg"))).toBe(true);

    const pressed = await rows();
    expect(pressed).toHaveLength(1);
    expect(pressed[0]).toMatchObject({ ok: 0, error: "unknown_media", proposed: "remove_photo" });
  });

  test("no tick and no src named proposes nothing", async () => {
    const ran = await runTool("alex", "remove_photo", {}, say, "2026-05-05");
    expect(ran.proposal).toBeUndefined();
    expect(ran.blocks).toEqual([{ shape: "say", text: "agent.tool.removePhotoNone" }]);
    expect(getEntryBySlug(REF, SLUG, AS_AUTHOR)?.gallery).toHaveLength(2);
  });

  test("somebody who is not the owner is refused", async () => {
    const src = srcOf("02.jpg");
    resolveAccess.mockResolvedValue({ email: "stranger@example.test" });
    const response = await post(removePhoto, "/api/helper/alex/day/remove-photo", {
      trip: TRIP,
      slug: SLUG,
      src,
    });
    expect(response.status).toBe(404);
    expect(getEntryBySlug(REF, SLUG, AS_AUTHOR)?.gallery).toHaveLength(2);
    expect(await rows()).toHaveLength(0);
  });
});

describe("discard_file — throwing away a staged file", () => {
  test("the tick proposes the file by name, and the press empties the inbox", async () => {
    const staged = await storeInboxFile("alex", "media", "harbour.jpg", await paintJpeg(400, 300, 4), {});
    const ran = await runTool(
      "alex",
      "discard_file",
      {},
      say,
      "2026-05-05",
      [`inbox:${staged.entry.id}`],
    );
    expect(ran.proposal?.fields).toEqual([{ name: "file", value: staged.entry.id }]);

    const response = await post(discardFile, "/api/helper/alex/inbox/discard", ran.proposal!.arguments);
    expect(response.status).toBe(200);
    expect(listInbox("alex").media).toHaveLength(0);
  });

  test("an id nothing answers to is refused, and nothing is written", async () => {
    const response = await post(discardFile, "/api/helper/alex/inbox/discard", { file: "not-a-real-id.jpg" });
    expect(response.status).toBe(404);
    const pressed = await rows();
    expect(pressed).toHaveLength(1);
    expect(pressed[0]).toMatchObject({ ok: 0, error: "unknown_inbox_file", proposed: "discard_file" });
  });

  test("nothing ticked and nothing named proposes nothing", async () => {
    const ran = await runTool("alex", "discard_file", {}, say, "2026-05-05");
    expect(ran.proposal).toBeUndefined();
    expect(ran.blocks).toEqual([{ shape: "say", text: "agent.tool.discardFileNone" }]);
  });

  test("somebody who is not the owner is refused", async () => {
    const staged = await storeInboxFile("alex", "media", "harbour.jpg", await paintJpeg(400, 300, 5), {});
    resolveAccess.mockResolvedValue({ email: "stranger@example.test" });
    const response = await post(discardFile, "/api/helper/alex/inbox/discard", { file: staged.entry.id });
    expect(response.status).toBe(404);
    expect(listInbox("alex").media).toHaveLength(1);
    expect(await rows()).toHaveLength(0);
  });
});
