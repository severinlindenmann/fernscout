import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { migrateToLatest } from "@/lib/db/migrate";
import { forget, history } from "@/lib/helper/thread";

/**
 * The write says so itself — B939.
 *
 * A tester pressed the helper's own write routes with `curl` and was told on
 * the next turn that their trip was *"waiting for you to press"* while it sat
 * on disk. The reason was not that presses went unrecorded: they were, by a
 * second call the **browser** made afterwards. Any other caller — a script, a
 * second tab, a phone client — left the conversation believing nothing had
 * happened, because the knowledge that a write must be announced lived in a
 * React component.
 *
 * So this drives the routes the way that tester did: press, and nothing else.
 * Every one of them has to leave a note behind on its own.
 *
 * It also asserts the half that made the old note thin — **the note carries
 * what the route produced, not what it was given.** A trip's id is derived at
 * creation, so a note built from the request's arguments knew the title and
 * never the id, and the model asked outright said it could not answer.
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

const { POST: createTrip } = await import("@/app/api/helper/[user]/trip/route");
const { POST: startDay, PATCH: setWords } = await import("@/app/api/helper/[user]/day/route");
const { POST: addCost } = await import("@/app/api/helper/[user]/day/costs/route");
const { POST: publishDay } = await import("@/app/api/helper/[user]/day/publish/route");
const { POST: unpublishDay } = await import("@/app/api/helper/[user]/day/unpublish/route");

let dir: string;
const params = { params: Promise.resolve({ user: "alex" }) };

function post(body: unknown, method = "POST") {
  return new Request("https://t.test/x", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Every note the conversation is holding, as one string. */
async function notes() {
  return (await history("alex"))
    .filter((turn) => turn.role === "note")
    .map((turn) => turn.text)
    .join("\n");
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-write-notes-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "test.db")}`;
  process.env.SESSION_SECRET = "helper-write-notes-secret-b939";
  process.env.ANTHROPIC_API_KEY = "not-a-real-key";
  resolveAccess.mockResolvedValue({ email: OWNER_EMAIL });
  forget("alex");

  fs.mkdirSync(path.join(dir, "alex", "trips"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "alex", "config.json"),
    JSON.stringify({
      title: "Alex",
      tagline: "t",
      owner: { name: "A B", nickname: "A", email: OWNER_EMAIL },
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
      features: { helper: { enabled: true } },
    }),
  );
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "T", url: "https://t.test" },
      features: { auth: { enabled: true }, credits: { enabled: true }, helper: { enabled: true } },
    }),
  );
  clearConfigCache();
  clearUserCache();
  await migrateToLatest(await getDatabase());
});

afterEach(async () => {
  await closeDatabase();
  forget("alex");
  delete process.env.CONTENT_DIR;
  delete process.env.DATABASE_URL;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("a press with no client behind it", () => {
  test("the whole journey leaves the conversation knowing what happened", async () => {
    const response = await createTrip(post({ title: "Am See", start: "2026-05-01", end: "2026-05-03" }), params);
    const made = await response.json();
    expect(made.ok).toBe(true);

    // The id the server derived — the one fact nobody in the conversation
    // could otherwise know, and the one the old note dropped.
    expect(made.id).toBe("am-see-2026");
    expect(await notes()).toContain("create_trip");
    expect(await notes()).toContain("am-see-2026");

    const started = await (
      await startDay(post({ trip: made.id, date: "2026-05-01", costs: "unknown", coordinates: "unknown" }), params)
    ).json();
    expect(started.ok).toBe(true);
    expect(await notes()).toContain(`start_day`);
    expect(await notes()).toContain(started.slug);

    const worded = await setWords(
      post({ trip: made.id, slug: started.slug, title: "Der erste Tag", content: "Enten." }, "PATCH"),
      params,
    );
    expect(worded.status).toBe(200);
    expect(await notes()).toContain("set_day_words");

    const cost = await addCost(
      post({ trip: made.id, slug: started.slug, label: "Kaffee", amount: "4.50", currency: "CHF", category: "food" }),
      params,
    );
    expect(cost.status).toBe(200);
    expect(await notes()).toContain("add_cost");

    const up = await publishDay(post({ trip: made.id, slug: started.slug, photos: "none" }), params);
    expect(up.status).toBe(200);
    expect(await notes()).toContain("publish_day");

    const down = await unpublishDay(post({ trip: made.id, slug: started.slug }), params);
    expect(down.status).toBe(200);
    expect(await notes()).toContain("unpublish_day");
  });

  test("a refused write leaves nothing behind", async () => {
    const refused = await createTrip(post({ title: "", start: "nope", end: "nope" }), params);
    expect(refused.status).toBe(400);
    // B922's shape, at the other end: the conversation must not learn about a
    // write that did not happen. That is worse than not learning about one
    // that did — a person can be told again, but a false claim is unrecoverable.
    expect(await notes()).toBe("");
  });
});
