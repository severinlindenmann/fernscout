import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { migrateToLatest } from "@/lib/db/migrate";
import { issueCode, verifyCode } from "@/lib/auth";
import { POST as createTripRoute } from "@/app/api/v1/[user]/trips/route";

/**
 * The whole wizard, driven the way the browser drives it — B682.
 *
 * The acceptance is a person writing a day from a phone and publishing it with
 * every optional capability off and no credits spent, so this runs with every
 * optional capability off: no weather, no address lookup, no model, nothing to
 * pay for. What it is really checking is the part that has no UI — that the
 * trip's own questions (`lib/tracks.ts`) can be *answered* from the wizard,
 * because a flow that can write a day and then never publish it is the failure
 * this would otherwise ship.
 */

const OWNER_EMAIL = "alex@example.test";

const { resolveAccess } = vi.hoisted(() => ({
  resolveAccess: vi.fn(async () => ({ email: OWNER_EMAIL as string | null })),
}));
vi.mock("@/lib/auth/handshake", () => ({ resolveAccess }));

const { GET, PATCH, POST } = await import("@/app/api/helper/[user]/day/route");
const { POST: publishRoute } = await import("@/app/api/helper/[user]/day/publish/route");

let dir: string;

const params = { params: Promise.resolve({ user: "alex" }) };

function json(method: string, body: unknown) {
  return new Request("https://t.test/api/helper/alex/day", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function read(response: Response) {
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-agent-wizard-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "test.db")}`;
  process.env.SESSION_SECRET = "agent-wizard-test-secret-b682";
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
      headers: {
        authorization: `Bearer ${verified.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        id: "a-trip",
        title: "A trip",
        start: "2026-05-01",
        end: "2026-05-31",
      }),
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

describe("writing a day from the wizard", () => {
  test("asks what the trip keeps track of, then writes, then publishes", async () => {
    // A day with no coordinates and no money is not refused with a shrug: the
    // trip's questions come back by name, which is what the wizard turns into
    // a pair of buttons per row.
    const asked = await read(await POST(json("POST", { trip: "a-trip", date: "2026-05-04" }), params));
    expect(asked.status).toBe(422);
    expect(asked.body.missing).toEqual(["costs", "coordinates"]);

    const made = await read(
      await POST(
        json("POST", {
          trip: "a-trip",
          date: "2026-05-04",
          answers: { costs: "none", coordinates: "unknown" },
        }),
        params,
      ),
    );
    expect(made.status).toBe(201);
    const slug = String(made.body.slug);

    // Created, and visibly unwritten: the title is the date and the prose is
    // the placeholder, so nothing here reads as somebody's words.
    const started = await read(
      await GET(new Request(`https://t.test/api/helper/alex/day?trip=a-trip&slug=${slug}`), params),
    );
    expect(started.status).toBe(200);
    expect(started.body.draft).toMatchObject({ written: false, photos: 0, date: "2026-05-04" });

    const written = await read(
      await PATCH(
        json("PATCH", {
          trip: "a-trip",
          slug,
          title: "The pass was shut",
          content: "The pass was shut and nobody had said so.",
        }),
        params,
      ),
    );
    expect(written.status).toBe(200);
    expect(written.body.draft).toMatchObject({ written: true, title: "The pass was shut" });

    // Photographs are only ever asked for here, because a day cannot carry one
    // at the moment it is written.
    const held = await read(await publishRoute(json("POST", { trip: "a-trip", slug }), params));
    expect(held.status).toBe(422);
    expect(held.body.missing).toEqual(["photos"]);

    await PATCH(json("PATCH", { trip: "a-trip", slug, answers: { photos: "unknown" } }), params);

    const live = await read(await publishRoute(json("POST", { trip: "a-trip", slug }), params));
    expect(live.status).toBe(200);
    expect(live.body.url).toBe(`https://t.test/alex/trips/a-trip/day/${slug}`);

    // Published once and only once — an agent, or a double tap, that gets a
    // cheerful second 200 would report a thing that happened last week.
    const again = await read(await publishRoute(json("POST", { trip: "a-trip", slug }), params));
    expect(again.status).toBe(409);
  });

  test("the day is written as a draft and nothing publishes it but the button", async () => {
    const made = await read(
      await POST(
        json("POST", {
          trip: "a-trip",
          date: "2026-05-05",
          answers: { costs: "none", coordinates: "unknown" },
        }),
        params,
      ),
    );
    expect(made.status).toBe(201);
    const entries = path.join(dir, "alex", "trips", "a-trip", "entries");
    const written = fs
      .readdirSync(entries)
      .map((file) => fs.readFileSync(path.join(entries, file), "utf8"));
    expect(written).toHaveLength(1);
    expect(written[0]).toContain("status: draft");
  });

  test("somebody else's cookie sees nothing at all", async () => {
    resolveAccess.mockResolvedValue({ email: "someone@example.test" });
    const refused = await read(
      await GET(new Request("https://t.test/api/helper/alex/day?trip=a-trip&slug=x"), params),
    );
    expect(refused.status).toBe(404);
    expect(refused.body.error).toBe("not_your_journal");

    // Nobody signed in at all is a different sentence — B807. It says the
    // session has lapsed, which is safe because with no address every username
    // on the instance answers this identically.
    resolveAccess.mockResolvedValue({ email: null });
    const anonymous = await read(
      await POST(json("POST", { trip: "a-trip", date: "2026-05-06" }), params),
    );
    expect(anonymous.status).toBe(401);
    expect(anonymous.body.error).toBe("session_lapsed");
  });
});
