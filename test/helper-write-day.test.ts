import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { migrateToLatest } from "@/lib/db/migrate";
import { balanceOf, grant } from "@/lib/credits";
import { clearIdempotencyStore } from "@/lib/idempotency";
import { buildPrompt, SYSTEM_PROMPT } from "@/lib/helper/model";
import { issueCode, verifyCode } from "@/lib/auth";
import { POST as createTripRoute } from "@/app/api/v1/[user]/trips/route";

/**
 * The model layer — B684.
 *
 * **Nothing here reaches a network.** `writeDay` is stubbed, which is the only
 * honest way to test this: what a model says is not assertable, and the things
 * that actually go wrong are on either side of it — what it was *given*, and
 * what the ledger did while it was away.
 *
 * So the assertions are: the prompt carries the facts it was handed, the first
 * model call for a journal is refused until somebody has consented, one
 * write-up costs exactly one credit, a retry under the same idempotency key
 * costs nothing, a failure gives the credit back, and the capability being off
 * is a refusal rather than a fault.
 */

const OWNER_EMAIL = "alex@example.test";

const { resolveAccess } = vi.hoisted(() => ({
  resolveAccess: vi.fn(async () => ({ email: OWNER_EMAIL as string | null })),
}));
vi.mock("@/lib/auth/handshake", () => ({ resolveAccess }));

const { writeDay } = vi.hoisted(() => ({ writeDay: vi.fn() }));
vi.mock("@/lib/helper/model", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/helper/model")>()),
  writeDay,
}));

const { POST } = await import("@/app/api/helper/[user]/day/write-day/route");
const { POST: consentRoute } = await import("@/app/api/helper/[user]/consent/route");

let dir: string;
const params = { params: Promise.resolve({ user: "alex" }) };

function json(body: unknown) {
  return new Request("https://t.test/api/helper/alex/day/write-day", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const NOTES = "Bus to the pass, three hours. Ate at the shack by the barrier.";

function call(over: Record<string, unknown> = {}) {
  return POST(
    json({
      trip: "a-trip",
      date: "2026-05-04",
      notes: NOTES,
      location: "Kunlun Pass",
      country: "China",
      photos: 9,
      idempotency_key: "one",
      ...over,
    }),
    params,
  );
}

async function read(response: Response) {
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

function writeConfig(features: Record<string, unknown>) {
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({ site: { name: "T", url: "https://t.test" }, features }),
  );
  clearConfigCache();
  clearUserCache();
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-helper-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "test.db")}`;
  process.env.SESSION_SECRET = "helper-write-day-secret-b684";
  process.env.ANTHROPIC_API_KEY = "not-a-real-key";
  resolveAccess.mockResolvedValue({ email: OWNER_EMAIL });
  writeDay.mockReset();
  writeDay.mockResolvedValue({ title: "The pass", prose: "The bus took three hours.", warnings: [] });
  clearIdempotencyStore();

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
  writeConfig({
    auth: { enabled: true },
    credits: { enabled: true },
    helper: { enabled: true },
  });
  await migrateToLatest(await getDatabase());
  await grant("alex", 10);

  const { code } = await issueCode("alex", OWNER_EMAIL, "agent");
  const verified = await verifyCode("alex", OWNER_EMAIL, code, "agent");
  if (!verified.ok) throw new Error("no token");
  await createTripRoute(
    new Request("https://t.test/api/v1/alex/trips", {
      method: "POST",
      headers: { authorization: `Bearer ${verified.token}`, "content-type": "application/json" },
      body: JSON.stringify({
        id: "a-trip",
        title: "Over the pass",
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
  delete process.env.ANTHROPIC_API_KEY;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("what the model is told", () => {
  test("the prompt carries every fact it was given, and the notes verbatim", () => {
    const prompt = buildPrompt(NOTES, {
      date: "2026-05-04",
      trip: "Over the pass",
      location: "Kunlun Pass",
      country: "China",
      from: "07:15",
      to: "16:40",
      photos: 9,
    });
    expect(prompt).toContain("2026-05-04");
    expect(prompt).toContain("Over the pass");
    expect(prompt).toContain("Kunlun Pass");
    expect(prompt).toContain("China");
    expect(prompt).toContain("07:15");
    expect(prompt).toContain("16:40");
    expect(prompt).toContain("9");
    expect(prompt).toContain(NOTES);
  });

  test("a fact nobody has is simply absent, rather than an empty label", () => {
    const prompt = buildPrompt("A quiet day.", { date: "2026-05-04" });
    expect(prompt).not.toContain("Place:");
    expect(prompt).not.toContain("Photographs on this day");
  });

  /** The system prompt is the product, so its three load-bearing rules are
   *  asserted rather than trusted to survive an edit. */
  test("the system prompt still carries the invention rule", () => {
    expect(SYSTEM_PROMPT).toContain("WRITE ONLY WHAT YOU WERE TOLD");
    expect(SYSTEM_PROMPT).toMatch(/never write about the weather/i);
    expect(SYSTEM_PROMPT).toMatch(/never translate/i);
  });

  test("the route hands the model the words and the facts it was sent", async () => {
    await consentRoute(new Request("https://t.test/api/helper/alex/consent", { method: "POST" }), params);
    await call();
    expect(writeDay).toHaveBeenCalledTimes(1);
    const [notes, facts] = writeDay.mock.calls[0];
    expect(notes).toBe(NOTES);
    expect(facts).toMatchObject({
      date: "2026-05-04",
      trip: "Over the pass",
      location: "Kunlun Pass",
      country: "China",
      photos: 9,
    });
  });
});

describe("consent, before the first call", () => {
  test("is refused until it is given, and nothing is charged for the refusal", async () => {
    const refused = await read(await call());
    expect(refused.status).toBe(403);
    expect(refused.body.error).toBe("consent_required");
    expect(writeDay).not.toHaveBeenCalled();
    expect(await balanceOf("alex")).toBe(10);
  });

  test("once given, the same call goes through", async () => {
    await consentRoute(new Request("https://t.test/api/helper/alex/consent", { method: "POST" }), params);
    const done = await read(await call());
    expect(done.status).toBe(200);
    expect(done.body.draft).toMatchObject({ title: "The pass" });
  });
});

describe("what it costs", () => {
  beforeEach(async () => {
    await consentRoute(new Request("https://t.test/api/helper/alex/consent", { method: "POST" }), params);
  });

  test("one credit per write-up", async () => {
    await call();
    expect(await balanceOf("alex")).toBe(9);
  });

  test("a retry under the same key is answered, not charged again", async () => {
    const first = await read(await call());
    const again = await read(await call());
    expect(again.status).toBe(200);
    expect(again.body).toEqual(first.body);
    expect(writeDay).toHaveBeenCalledTimes(1);
    expect(await balanceOf("alex")).toBe(9);
  });

  test("a failed model call gives the credit back", async () => {
    writeDay.mockRejectedValueOnce(new Error("provider is unhappy"));
    const failed = await read(await call());
    expect(failed.status).toBe(502);
    expect(await balanceOf("alex")).toBe(10);
  });

  test("an empty balance refuses rather than writing for free", async () => {
    await call();
    await call({ idempotency_key: "two", notes: "Another day entirely." });
    // Nine calls in, and the tenth is the last one the balance covers.
    for (let n = 3; n <= 10; n += 1) {
      await call({ idempotency_key: `k${n}`, notes: `Day ${n}.` });
    }
    const broke = await read(await call({ idempotency_key: "last", notes: "One more." }));
    expect(broke.status).toBe(402);
    expect(await balanceOf("alex")).toBe(0);
  });
});

describe("with the capability off", () => {
  test("the route refuses rather than failing", async () => {
    writeConfig({ auth: { enabled: true }, credits: { enabled: true } });
    const refused = await read(await call());
    expect(refused.status).toBe(404);
    expect(refused.body.error).toBe("helper_unavailable");
    expect(writeDay).not.toHaveBeenCalled();
  });

  test("switched on with no credits capability, it stays off and says why", async () => {
    writeConfig({ auth: { enabled: true }, helper: { enabled: true } });
    const { resolveCapabilities } = await import("@/lib/capabilities");
    const state = resolveCapabilities("alex").helper;
    expect(state.enabled).toBe(false);
    expect(state.enabled === false && state.reason).toContain("features.credits");
  });

  test("switched on with no key, it stays off and names the variable", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const { resolveCapabilities } = await import("@/lib/capabilities");
    const state = resolveCapabilities("alex").helper;
    expect(state.enabled).toBe(false);
    expect(state.enabled === false && state.reason).toContain("ANTHROPIC_API_KEY");
  });
});
