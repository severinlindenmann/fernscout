import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { migrateToLatest } from "@/lib/db/migrate";

/**
 * The rest of the wizard's write routes, wired the same way — B985.
 *
 * B976 gave two routes a `refused()` call and left the other seven silent: a
 * press that failed on its content left no row, so the operator's acceptance
 * rate could not tell "nobody pressed" from "somebody pressed and it was
 * refused". This drives three of the seven into a refusal each and checks the
 * row lands with the route's own error code — and, the other half of the
 * rule, that a refusal from the ownership gate itself leaves nothing, because
 * that failure is not about what was pressed.
 */

const OWNER_EMAIL = "alex@example.test";

const { resolveAccess } = vi.hoisted(() => ({
  resolveAccess: vi.fn(async () => ({ email: OWNER_EMAIL as string | null })),
}));
vi.mock("@/lib/auth/handshake", () => ({ resolveAccess }));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers(),
}));

const { POST: unpublishDay } = await import("@/app/api/helper/[user]/day/unpublish/route");
const { POST: attachFiles } = await import("@/app/api/helper/[user]/day/attach/route");
const { POST: inviteGuest } = await import("@/app/api/helper/[user]/invite/route");

let dir: string;
const params = { params: Promise.resolve({ user: "alex" }) };

async function rows() {
  const { db } = (await getDatabase())!;
  return db.selectFrom("helper_sessions").selectAll().where("kind", "=", "press").execute();
}

function post(
  route: (request: Request, context: typeof params) => Promise<Response>,
  url: string,
  body: unknown,
) {
  return route(
    new Request(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    params,
  );
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-write-refusals-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "test.db")}`;
  process.env.SESSION_SECRET = "helper-write-refusals-secret-b985";
  process.env.ANTHROPIC_API_KEY = "not-a-real-key";
  resolveAccess.mockResolvedValue({ email: OWNER_EMAIL });

  fs.mkdirSync(path.join(dir, "alex", "trips", "reise", "entries"), { recursive: true });
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
      features: { auth: { enabled: true }, credits: { enabled: true }, helper: { enabled: true } },
    }),
  );
  fs.writeFileSync(
    path.join(dir, "alex", "trips", "reise", "trip.md"),
    ["---", "id: reise", "title: Die Reise", 'start: "2026-05-01"', 'end: "2026-05-10"', "visibility: private", "---", "", "Intro."].join(
      "\n",
    ),
  );
  fs.writeFileSync(
    path.join(dir, "alex", "trips", "reise", "entries", "2026-05-01-day.md"),
    ["---", "date: 2026-05-01", "title: Day one", "status: draft", "---", "", "Nothing yet."].join("\n"),
  );
  clearConfigCache();
  clearUserCache();
  await migrateToLatest(await getDatabase());
});

afterEach(async () => {
  await closeDatabase();
  delete process.env.CONTENT_DIR;
  delete process.env.DATABASE_URL;
  delete process.env.SESSION_SECRET;
  delete process.env.ANTHROPIC_API_KEY;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("a press refused on its content leaves a row", () => {
  test("unpublish_day, on a day that was never published", async () => {
    const res = await post(unpublishDay, "https://t.test/api/helper/alex/day/unpublish", {
      trip: "reise",
      slug: "day",
    });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("already_draft");

    const pressed = await rows();
    expect(pressed).toHaveLength(1);
    expect(pressed[0]).toMatchObject({ ok: 0, error: "already_draft", proposed: "unpublish_day" });
  });

  test("attach_files, with no files named", async () => {
    const res = await post(attachFiles, "https://t.test/api/helper/alex/day/attach", {
      trip: "reise",
      slug: "day",
      files: "",
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("expected_files");

    const pressed = await rows();
    expect(pressed).toHaveLength(1);
    expect(pressed[0]).toMatchObject({ ok: 0, error: "expected_files", proposed: "attach_files" });
  });

  test("invite_guest, on a journal that never turned contacts on", async () => {
    const res = await post(inviteGuest, "https://t.test/api/helper/alex/invite", {});
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("contacts_disabled");

    const pressed = await rows();
    expect(pressed).toHaveLength(1);
    expect(pressed[0]).toMatchObject({ ok: 0, error: "contacts_disabled", proposed: "invite_guest" });
  });
});

describe("a refusal from the ownership gate is not a press", () => {
  test("not_your_journal leaves no row at all", async () => {
    resolveAccess.mockResolvedValue({ email: "somebody-else@example.test" });

    const res = await post(unpublishDay, "https://t.test/api/helper/alex/day/unpublish", {
      trip: "reise",
      slug: "day",
    });
    expect(res.status).toBe(404);

    expect(await rows()).toHaveLength(0);
  });
});
