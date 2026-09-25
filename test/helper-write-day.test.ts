import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { migrateToLatest } from "@/lib/db/migrate";
import { balanceOf, grant, spend } from "@/lib/credits";
import { resetRateLimitsForTests } from "@/lib/rateLimit";
import { clearIdempotencyStore } from "@/lib/idempotency";
import { buildPrompt, SYSTEM_PROMPT } from "@/lib/helper/model";
import { history } from "@/lib/helper/thread";
import { createTrip } from "@/lib/tripWrite";

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
  // Each test starts with a fresh bucket: the route's 20-per-15-minutes brake
  // is per IP and in-memory, so it otherwise counts every call in this file.
  resetRateLimitsForTests();

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

  const created = createTrip("alex", { id: "a-trip", title: "Over the pass", start: "2026-05-01", end: "2026-05-31" });
  if (!created.ok) throw new Error(`trip fixture failed: ${created.message}`);
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
    // B766: a person's own words about the weather stay; the model never
    // supplies a temperature, a condition or a forecast of its own.
    expect(SYSTEM_PROMPT).toMatch(/person's own memory of the weather stays in/i);
    expect(SYSTEM_PROMPT).not.toMatch(/never write about the weather/i);
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

  /**
   * B971 — saying "that looks good, save it" re-offered the same
   * `draft_words` card instead of the `set_day_words` one, because the model
   * had nowhere the drafted title and prose actually lived: the note said a
   * draft existed but not what it said, and the words themselves are shown
   * only in the proposal's own form fields, which never reach the
   * conversation. The note now carries them, so the next turn can call
   * `set_day_words` with the words the person actually read.
   */
  test("the note carries the drafted title and prose, not just that one exists", async () => {
    await consentRoute(new Request("https://t.test/api/helper/alex/consent", { method: "POST" }), params);
    await call();
    const notes = (await history("alex")).filter((turn) => turn.role === "note");
    const drafted = notes.find((turn) => turn.text.includes("drafted:"));
    expect(drafted).toBeDefined();
    expect(drafted?.text).toContain("set_day_words");
    expect(drafted?.text).toContain("The pass");
    expect(drafted?.text).toContain("The bus took three hours.");
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

  // B2186 repriced this from 1 credit to 0.05 — a whole credit for one
  // Haiku call on a paragraph cost the operator well under a cent.
  test("0.05 credit per write-up", async () => {
    await call();
    expect(await balanceOf("alex")).toBe(9.95);
  });

  // B2223 — a flat price over a per-token cost needs a ceiling on the input.
  test.each(["draft", "polish"])("notes over the cap are refused with 413 in %s mode, before any spend", async (mode) => {
    const { WRITE_DAY_NOTES_MAX_CHARS } = await import("@/lib/helper/credits");
    const response = await call({ mode, notes: "a".repeat(WRITE_DAY_NOTES_MAX_CHARS + 1) });
    expect(response.status).toBe(413);
    const body = (await response.json()) as { error: string; message: string; maxChars: number };
    expect(body.error).toBe("notes_too_long");
    expect(body.maxChars).toBe(WRITE_DAY_NOTES_MAX_CHARS);
    expect(body.message).toContain(String(WRITE_DAY_NOTES_MAX_CHARS));
    expect(writeDay).not.toHaveBeenCalled();
    expect(await balanceOf("alex")).toBe(10);
  });

  test("B2243 — a JSON body over the ceiling is refused with 413 before it is parsed or charged", async () => {
    const { JSON_BODY_MAX_BYTES } = await import("@/lib/api/jsonBody");
    const response = await POST(
      new Request("https://t.test/api/helper/alex/day/write-day", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ trip: "a-trip", notes: "x".repeat(JSON_BODY_MAX_BYTES) }),
      }),
      params,
    );
    expect(response.status).toBe(413);
    expect(((await response.json()) as { error: string }).error).toBe("body_too_large");
    expect(writeDay).not.toHaveBeenCalled();
    expect(await balanceOf("alex")).toBe(10);
  });

  // B2223 review F2 — the facts ride into the prompt too.
  test.each(["location", "country", "from", "to"])("a %s over the cap is refused with 413 before any spend", async (field) => {
    const { WRITE_DAY_FACT_MAX_CHARS } = await import("@/lib/helper/credits");
    const response = await call({ [field]: "p".repeat(WRITE_DAY_FACT_MAX_CHARS + 1) });
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ error: "fact_too_long", field, maxChars: WRITE_DAY_FACT_MAX_CHARS });
    expect(writeDay).not.toHaveBeenCalled();
    expect(await balanceOf("alex")).toBe(10);
  });

  test("a date that is not YYYY-MM-DD is refused with 400 before any spend", async () => {
    const response = await call({ date: "x".repeat(5000) });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toBe("invalid_date");
    expect(writeDay).not.toHaveBeenCalled();
    expect(await balanceOf("alex")).toBe(10);
  });

  test("notes exactly at the cap still go through", async () => {
    const { WRITE_DAY_NOTES_MAX_CHARS } = await import("@/lib/helper/credits");
    const response = await call({ notes: "a".repeat(WRITE_DAY_NOTES_MAX_CHARS) });
    expect(response.status).toBe(200);
  });

  test("a retry under the same key is answered, not charged again", async () => {
    const first = await read(await call());
    const again = await read(await call());
    expect(again.status).toBe(200);
    expect(again.body).toEqual(first.body);
    expect(writeDay).toHaveBeenCalledTimes(1);
    expect(await balanceOf("alex")).toBe(9.95);
  });

  test("a failed model call gives the credit back", async () => {
    writeDay.mockRejectedValueOnce(new Error("provider is unhappy"));
    const failed = await read(await call());
    expect(failed.status).toBe(502);
    expect(await balanceOf("alex")).toBe(10);
  });

  test("an empty balance refuses rather than writing for free", async () => {
    expect(await spend("alex", 10, "helper", "drain-for-test")).toBe(true);
    const broke = await read(await call());
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

  // Open core (open-core/split): B684 kept the helper off without credits; it
  // no longer needs them.
  test("switched on with no credits capability, it comes on", async () => {
    writeConfig({ auth: { enabled: true }, helper: { enabled: true } });
    const { resolveCapabilities } = await import("@/lib/capabilities");
    expect(resolveCapabilities("alex").helper.enabled).toBe(true);
  });

  test("switched on with no key, it stays off and names the variable", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const { resolveCapabilities } = await import("@/lib/capabilities");
    const state = resolveCapabilities("alex").helper;
    expect(state.enabled).toBe(false);
    expect(state.enabled === false && state.reason).toContain("ANTHROPIC_API_KEY");
  });
});

/**
 * The valve points at the model, not at the person — B945.
 *
 * `warnings` exists so the model has somewhere to say what it deliberately
 * left out, which is what makes leaving something out an acceptable answer
 * rather than a failure. Handing that list on turned it into a claim, and
 * driven live it made a false one: notes saying *"rained most of the afternoon
 * so we ducked into the maritime museum"* came back with the rain in the prose
 * **and** a warning saying the weather had been omitted from it.
 *
 * Nothing rendered the list, so nobody saw it until a tester read the JSON.
 */
/**
 * `mode: "polish"` — B2190. The route-level tests above mock `writeDay`
 * itself, so they say nothing about the real prompt or the real guard; this
 * checks the wiring around it — mode reaches `writeDay`, no title comes back,
 * a refused polish refunds and is never noted into the thread.
 */
describe("polish mode", () => {
  beforeEach(async () => {
    await consentRoute(new Request("https://t.test/api/helper/alex/consent", { method: "POST" }), params);
  });

  test("passes mode through to writeDay and drops the title", async () => {
    // The prose has to be something the real guard would actually pass —
    // words reused from the notes, not an arbitrary stand-in — now that a
    // sentence-initial capital is no longer exempt on its own.
    writeDay.mockResolvedValue({ title: "", prose: "Rain all morning, then port at grahams.", warnings: [] });
    const answered = await read(await call({ mode: "polish", notes: "rain all morning then port at grahams" }));
    expect(answered.status).toBe(200);
    expect(writeDay).toHaveBeenCalledWith(
      "rain all morning then port at grahams",
      expect.anything(),
      "alex",
      "polish",
    );
    expect(answered.body.draft).toMatchObject({ title: "", prose: "Rain all morning, then port at grahams." });
  });

  test("a polish that adds a fact is refused, refunded, and not charged", async () => {
    writeDay.mockResolvedValue({ title: "", prose: "We walked 5 kilometers to the port.", warnings: [] });
    const refused = await read(await call({ mode: "polish", notes: "walked to the port", idempotency_key: "polish-fact" }));
    expect(refused.status).toBe(422);
    expect(refused.body.error).toBe("polish_added_facts");
    expect(await balanceOf("alex")).toBe(10);
  });

  test("a polish that introduces a new name is refused (B2190 security follow-up)", async () => {
    writeDay.mockResolvedValue({
      title: "",
      prose: "Zurich was lovely, we wandered around in Zurich for hours.",
      warnings: [],
    });
    const refused = await read(
      await call({ mode: "polish", notes: "the old town was lovely, we wandered for hours", idempotency_key: "polish-zurich" }),
    );
    expect(refused.status).toBe(422);
    expect(refused.body.error).toBe("polish_added_facts");
    expect(await balanceOf("alex")).toBe(10);
  });

  test("a clean polish is never noted into the thread as a draft to keep", async () => {
    writeDay.mockResolvedValue({ title: "", prose: "Rain all morning, then port at Graham's.", warnings: [] });
    const before = (await history("alex")).length;
    await call({ mode: "polish", notes: "rain all morning then port at grahams", idempotency_key: "polish-note" });
    const after = await history("alex");
    expect(after.length).toBe(before);
  });

  test("draft mode (the default) is unaffected: no mode field still writes the note", async () => {
    await call({ idempotency_key: "still-draft" });
    const notes = (await history("alex")).filter((turn) => turn.role === "note");
    expect(notes.find((turn) => turn.text.includes("drafted:"))).toBeDefined();
  });
});

describe("what the drafted day is answered with", () => {
  test("carries the title and the prose, and not the model's own notes to itself", async () => {
    writeDay.mockResolvedValue({
      title: "The pass",
      prose: "It rained, so we went into the museum.",
      warnings: ["Weather mentioned in notes but omitted from prose."],
    });
    await consentRoute(new Request("https://t.test/api/helper/alex/consent", { method: "POST" }), params);
    const answered = await call({ notes: "regen, museum", idempotency_key: "valve" });
    expect(answered.status).toBe(200);

    const body = (await answered.json()) as { draft: Record<string, unknown> };
    expect(body.draft.title).toBe("The pass");
    expect(body.draft.prose).toBe("It rained, so we went into the museum.");
    expect(body.draft).not.toHaveProperty("warnings");
    // And nowhere else in the answer either.
    expect(JSON.stringify(body)).not.toContain("omitted");
  });
});
