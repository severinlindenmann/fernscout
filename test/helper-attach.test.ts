import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { migrateToLatest } from "@/lib/db/migrate";
import { AS_AUTHOR, getEntryBySlug } from "@/lib/entries";
import { describeSelection } from "@/lib/helper/server";
import { listInbox, storeInboxFile } from "@/lib/inbox";
import { runTool } from "@/lib/helper/tools";
import { paintJpeg } from "./support/pictures";

/**
 * B915 — a photograph in the inbox, put on a day from a browser.
 *
 * The files pane could tick two photographs and have the sentence "put these
 * on yesterday" understood; it ended in a link, because the only route that
 * could move a staged file onto a day read a bearer token and a browser has a
 * cookie. What is asserted here is the whole chain: the selection line names
 * the ids a tool can be called with, the tool **proposes and writes nothing**,
 * and the press moves the files — out of the inbox, onto the day, once.
 */

const OWNER_EMAIL = "alex@example.test";

const { resolveAccess } = vi.hoisted(() => ({
  resolveAccess: vi.fn(async () => ({ email: OWNER_EMAIL as string | null })),
}));
vi.mock("@/lib/auth/handshake", () => ({ resolveAccess }));

const { POST } = await import("@/app/api/helper/[user]/day/attach/route");

const TRIP = "a-trip";
const REF = `alex/${TRIP}`;
const SLUG = "the-pass";
const params = { params: Promise.resolve({ user: "alex" }) };
let dir: string;

function attach(payload: unknown) {
  return POST(
    new Request("https://t.test/api/helper/alex/day/attach", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }),
    params,
  );
}

async function stage(name: string, seed: number) {
  return storeInboxFile("alex", "media", name, await paintJpeg(400, 300, seed), {});
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-attach-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "test.db")}`;
  process.env.SESSION_SECRET = "helper-attach-secret-b915";
  resolveAccess.mockResolvedValue({ email: OWNER_EMAIL });

  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "T", url: "https://t.test" },
      features: { auth: { enabled: true }, helper: { enabled: true } },
    }),
  );
  fs.mkdirSync(path.join(dir, "alex", "trips", TRIP, "entries"), { recursive: true });
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
    path.join(dir, "alex", "trips", TRIP, "trip.md"),
    ["---", `id: ${TRIP}`, 'title: "Over the pass"', 'start: "2026-05-01"', 'end: "2026-05-31"', "visibility: public", "---", "", "Trip.", ""].join("\n"),
  );
  fs.writeFileSync(
    path.join(dir, "alex", "trips", TRIP, "entries", `2026-05-04-${SLUG}.md`),
    ["---", 'title: "The pass"', 'date: "2026-05-04"', "status: draft", "---", "", "Words.", ""].join("\n"),
  );
  clearConfigCache();
  clearUserCache();
  await migrateToLatest(await getDatabase());
});

afterEach(async () => {
  await closeDatabase();
  delete process.env.CONTENT_DIR;
  delete process.env.DATABASE_URL;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("two photographs, ticked and put on a day", () => {
  test("the selection line names the ids the tool takes", async () => {
    const one = await stage("harbour.jpg", 1);
    const said = describeSelection("alex", [`inbox:${one.entry.id}`]);
    expect(said).toContain("harbour.jpg");
    expect(said).toContain(one.entry.id);
    expect(said).toContain("attach_files");
  });

  test("the tool proposes, names the day and the files, and writes nothing", async () => {
    const one = await stage("harbour.jpg", 1);
    const two = await stage("boats.jpg", 2);
    const ran = await runTool(
      "alex",
      "attach_files",
      { trip: TRIP, date: "2026-05-04", files: `${one.entry.id}, ${two.entry.id}` },
      (key) => key,
      "2026-05-05",
    );
    expect(ran.proposal?.tool).toBe("attach_files");
    expect(ran.proposal?.endpoint).toBe("/api/helper/alex/day/attach");
    // The day, then the two files by name, and then the press — never the
    // other way round.
    expect(ran.blocks.map((block) => block.shape)).toEqual(["preview", "confirm"]);
    expect((ran.blocks[0] as { lines: string[] }).lines).toEqual([
      "2026-05-04 — The pass",
      "harbour.jpg",
      "boats.jpg",
    ]);
    // The fields the press posts are the server's own resolution, not the
    // model's arguments.
    expect(ran.proposal?.fields).toEqual([
      { name: "trip", value: TRIP },
      { name: "slug", value: SLUG },
      { name: "files", value: `${one.entry.id},${two.entry.id}` },
    ]);
    expect(ran.result).toMatchObject({ proposed: true, wrote: false });
    // Still in the inbox, still off the day.
    expect(listInbox("alex").media).toHaveLength(2);
    expect(getEntryBySlug(REF, SLUG, AS_AUTHOR)?.gallery ?? []).toHaveLength(0);
  });

  test("the press puts them on the day and empties the inbox", async () => {
    const one = await stage("harbour.jpg", 1);
    const two = await stage("boats.jpg", 2);
    const response = await attach({
      trip: TRIP,
      slug: SLUG,
      files: `${one.entry.id},${two.entry.id}`,
    });
    expect(response.status).toBe(201);
    const body = (await response.json()) as { attached: number; moved: string[] };
    expect(body.attached).toBe(2);
    expect(body.moved).toEqual([one.entry.id, two.entry.id]);

    expect(getEntryBySlug(REF, SLUG, AS_AUTHOR)?.gallery).toHaveLength(2);
    // Moved, not copied: the pane must stop offering what is now on a day.
    expect(listInbox("alex").media).toHaveLength(0);
  });

  test("the same bytes again are recognised rather than stored twice", async () => {
    const one = await stage("harbour.jpg", 1);
    expect((await attach({ trip: TRIP, slug: SLUG, files: one.entry.id })).status).toBe(201);

    // The same photograph staged again — same bytes, so the inbox gives it the
    // same id, and the day already has it.
    const again = await stage("harbour.jpg", 1);
    expect(again.entry.id).toBe(one.entry.id);
    const response = await attach({ trip: TRIP, slug: SLUG, files: again.entry.id });
    expect(response.status).toBe(201);
    expect((await response.json()) as { skipped: number }).toMatchObject({ skipped: 1 });
    expect(getEntryBySlug(REF, SLUG, AS_AUTHOR)?.gallery).toHaveLength(1);
    expect(listInbox("alex").media).toHaveLength(0);
  });

  test("an id nothing answers to is refused, and nothing is written", async () => {
    const response = await attach({ trip: TRIP, slug: SLUG, files: "deadbeef-nope.jpg" });
    expect(response.status).toBe(400);
    expect((await response.json()) as { error: string }).toMatchObject({
      error: "unknown_inbox_file",
    });
    expect(getEntryBySlug(REF, SLUG, AS_AUTHOR)?.gallery ?? []).toHaveLength(0);
  });

  test("somebody who is not the owner is refused", async () => {
    const one = await stage("harbour.jpg", 1);
    resolveAccess.mockResolvedValue({ email: "stranger@example.test" });
    expect((await attach({ trip: TRIP, slug: SLUG, files: one.entry.id })).status).toBe(404);
    expect(listInbox("alex").media).toHaveLength(1);
  });
});
