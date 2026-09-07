import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { migrateToLatest } from "@/lib/db/migrate";
import { balanceOf, grant, ledgerFor } from "@/lib/credits";
import { intentList, REGISTRY } from "@/lib/helper/intents";
import { ROUTER_SYSTEM_PROMPT } from "@/lib/helper/model";
import { getTrips } from "@/lib/trips";

/**
 * The intent router — B685.
 *
 * **Nothing here reaches a network**: `routeAsk` is stubbed, because what a
 * model answers is not assertable and everything that matters is on either
 * side of it. What is asserted is the discipline: the menu the model is shown
 * is generated from the registry, a row that writes comes back as fields to
 * confirm rather than as a thing that happened, a row that only reads answers
 * on the spot, nonsense lands on `unknown`, the whole door is free, and a
 * bearer token gets nowhere near it.
 */

const OWNER_EMAIL = "alex@example.test";

const { resolveAccess } = vi.hoisted(() => ({
  resolveAccess: vi.fn(async () => ({ email: OWNER_EMAIL as string | null })),
}));
vi.mock("@/lib/auth/handshake", () => ({ resolveAccess }));

// A read-only answer is a sentence in the reader's own language, so the route
// asks `requestLocale()`, which reads `next/headers` and throws outside a real
// request scope. An empty jar is enough: it falls back to English, which is
// what the assertions below read.
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers(),
}));

const { routeAsk } = vi.hoisted(() => ({ routeAsk: vi.fn() }));
vi.mock("@/lib/helper/model", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/helper/model")>()),
  routeAsk,
}));

const { POST } = await import("@/app/api/helper/[user]/ask/route");
const { POST: tripRoute } = await import("@/app/api/helper/[user]/trip/route");
const { POST: consentRoute } = await import("@/app/api/helper/[user]/consent/route");

let dir: string;
const params = { params: Promise.resolve({ user: "alex" }) };

function post(url: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function ask(said: string, headers: Record<string, string> = {}) {
  return POST(post("https://t.test/api/helper/alex/ask", { said, today: "2026-09-07" }, headers), params);
}

async function read(response: Response) {
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-ask-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "test.db")}`;
  process.env.SESSION_SECRET = "helper-ask-secret-b685";
  process.env.ANTHROPIC_API_KEY = "not-a-real-key";
  resolveAccess.mockResolvedValue({ email: OWNER_EMAIL });
  routeAsk.mockReset();

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
      features: { auth: { enabled: true }, credits: { enabled: true }, helper: { enabled: true } },
    }),
  );
  clearConfigCache();
  clearUserCache();
  await migrateToLatest(await getDatabase());
  await grant("alex", 10);
  await consentRoute(new Request("https://t.test/api/helper/alex/consent", { method: "POST" }), params);
});

afterEach(async () => {
  await closeDatabase();
  delete process.env.CONTENT_DIR;
  delete process.env.DATABASE_URL;
  delete process.env.ANTHROPIC_API_KEY;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("what the model is shown", () => {
  test("the menu in the prompt is generated from the registry", () => {
    expect(ROUTER_SYSTEM_PROMPT).toContain(intentList());
    for (const row of REGISTRY) {
      expect(intentList()).toContain(row.name);
      expect(ROUTER_SYSTEM_PROMPT).toContain(row.name);
    }
  });

  test("every slot the registry declares is named to the model", () => {
    for (const row of REGISTRY) {
      for (const slot of row.slots) expect(intentList()).toContain(slot.name);
    }
  });

  test("unknown is offered as an answer in its own right", () => {
    expect(ROUTER_SYSTEM_PROMPT).toContain('"unknown"');
  });
});

describe("a row that writes", () => {
  beforeEach(() => {
    routeAsk.mockResolvedValue({
      intent: "new_trip",
      slots: { title: "Japan", start: "2027-03-01", end: "2027-03-31" },
      confidence: 0.9,
    });
  });

  test("comes back as fields to confirm, and writes nothing", async () => {
    const routed = await read(await ask("make a new trip to Japan in March"));
    expect(routed.status).toBe(200);
    expect(routed.body.intent).toBe("new_trip");
    expect(routed.body.kind).toBe("write");
    expect(routed.body.slots).toEqual({ title: "Japan", start: "2027-03-01", end: "2027-03-31" });
    expect(routed.body.fields).toEqual([
      { name: "title", value: "Japan", date: false },
      { name: "start", value: "2027-03-01", date: true },
      { name: "end", value: "2027-03-31", date: true },
    ]);
    // The whole point: the router ran and the journal is untouched.
    expect(getTrips("alex")).toHaveLength(0);
  });

  test("a high confidence changes nothing about that", async () => {
    routeAsk.mockResolvedValue({
      intent: "new_trip",
      slots: { title: "Japan", start: "2027-03-01", end: "2027-03-31" },
      confidence: 1,
    });
    const routed = await read(await ask("new trip to Japan"));
    expect(routed.body.kind).toBe("write");
    expect(getTrips("alex")).toHaveLength(0);
  });

  test("only the confirmed press writes it", async () => {
    const routed = await read(await ask("make a new trip to Japan in March"));
    const created = await read(
      await tripRoute(
        post(
          "https://t.test/api/helper/alex/trip",
          Object.fromEntries(
            (routed.body.fields as { name: string; value: string }[]).map((f) => [f.name, f.value]),
          ),
        ),
        params,
      ),
    );
    expect(created.status).toBe(201);
    expect(created.body.id).toBe("japan-2027");
    expect(getTrips("alex").map((t) => t.title)).toEqual(["Japan"]);
  });

  test("the model invented a slot nobody declared, and it is dropped", async () => {
    routeAsk.mockResolvedValue({
      intent: "new_trip",
      slots: { title: "Japan", start: "not a date", visibility: "public" },
      confidence: 0.9,
    });
    const routed = await read(await ask("new trip"));
    expect(routed.body.slots).toEqual({ title: "Japan" });
  });
});

describe("a row that only reads", () => {
  test("answers on the spot, with nothing to confirm", async () => {
    routeAsk.mockResolvedValue({ intent: "storage", slots: {}, confidence: 0.9 });
    const routed = await read(await ask("how much storage do I have"));
    expect(routed.body.kind).toBe("read");
    expect(routed.body.answer).toContain("free");
    expect(routed.body.fields).toBeUndefined();
  });

  test("credits are answered from the ledger, not guessed", async () => {
    routeAsk.mockResolvedValue({ intent: "credits", slots: {}, confidence: 0.9 });
    const routed = await read(await ask("how many credits"));
    expect(routed.body.answer).toContain("10");
  });
});

describe("when it does not know", () => {
  test("nonsense is unknown, and lands on the buttons", async () => {
    routeAsk.mockResolvedValue({ intent: "unknown", slots: {}, confidence: 0 });
    const routed = await read(await ask("asdf qwer zxcv"));
    expect(routed.status).toBe(200);
    expect(routed.body.intent).toBe("unknown");
    expect(routed.body.kind).toBe("unknown");
  });

  test("a row nobody has heard of is unknown rather than an error", async () => {
    routeAsk.mockResolvedValue({ intent: "delete_everything", slots: {}, confidence: 1 });
    const routed = await read(await ask("delete it all"));
    expect(routed.body.intent).toBe("unknown");
  });

  test("a half-sure guess is unknown too", async () => {
    routeAsk.mockResolvedValue({ intent: "new_trip", slots: { title: "?" }, confidence: 0.2 });
    const routed = await read(await ask("something about a trip maybe"));
    expect(routed.body.intent).toBe("unknown");
  });
});

describe("what it costs", () => {
  test("nothing: no credit moves and no ledger row is written", async () => {
    routeAsk.mockResolvedValue({ intent: "storage", slots: {}, confidence: 0.9 });
    await ask("how much storage do I have");
    await ask("and again");
    expect(await balanceOf("alex")).toBe(10);
    const rows = await ledgerFor("alex");
    expect(rows.filter((row) => row.reason === "helper")).toHaveLength(0);
    expect(rows).toHaveLength(1); // the grant, and nothing since
  });
});

describe("the door", () => {
  test("a bearer token is refused — this is a cookie route", async () => {
    resolveAccess.mockResolvedValue({ email: null });
    routeAsk.mockResolvedValue({ intent: "storage", slots: {}, confidence: 1 });
    const refused = await read(await ask("how much storage", { authorization: "Bearer whatever" }));
    expect(refused.status).toBe(404);
    expect(routeAsk).not.toHaveBeenCalled();
  });

  test("with the capability off the route refuses rather than failing", async () => {
    fs.writeFileSync(
      path.join(dir, "config.json"),
      JSON.stringify({
        site: { name: "T", url: "https://t.test" },
        features: { auth: { enabled: true }, credits: { enabled: true } },
      }),
    );
    clearConfigCache();
    clearUserCache();
    routeAsk.mockResolvedValue({ intent: "storage", slots: {}, confidence: 1 });
    const refused = await read(await ask("how much storage"));
    expect(refused.status).toBe(404);
    expect(refused.body.error).toBe("helper_unavailable");
    expect(routeAsk).not.toHaveBeenCalled();
  });

  test("the sentence is not sent before somebody has consented", async () => {
    const { revokeHelperConsent } = await import("@/lib/helper/consent");
    revokeHelperConsent("alex");
    const refused = await read(await ask("how much storage"));
    expect(refused.status).toBe(403);
    expect(refused.body.error).toBe("consent_required");
    expect(routeAsk).not.toHaveBeenCalled();
  });
});
