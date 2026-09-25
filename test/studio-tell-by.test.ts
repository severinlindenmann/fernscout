import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { assembleSpokenDay } from "@/lib/studio/speak";

/**
 * B2194 — "How do you like to tell it?" is asked once and remembered, through
 * the owner's cookie door only; and a day told by voice is exactly the
 * person's corrected answers, one paragraph each, skips left out, no question
 * text added.
 */

const OWNER = "alex";
let dir: string;
let isOwnerMock: ReturnType<typeof vi.fn>;

vi.mock("@/lib/contacts/session", () => ({ isOwner: vi.fn() }));

const params = Promise.resolve({ user: OWNER });
const req = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("https://t.test/api/web/alex/studio/tell-by", {
    method: "PATCH",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-tell-by-"));
  process.env.CONTENT_DIR = dir;
  clearUserCache();
  isOwnerMock = (await import("@/lib/contacts/session")).isOwner as unknown as ReturnType<typeof vi.fn>;
  isOwnerMock.mockClear();
  isOwnerMock.mockResolvedValue(true);
  fs.mkdirSync(path.join(dir, OWNER), { recursive: true });
  fs.writeFileSync(path.join(dir, "config.json"), JSON.stringify({ site: { name: "T", url: "https://t.test" }, features: {} }));
  clearConfigCache();
  fs.writeFileSync(
    path.join(dir, OWNER, "config.json"),
    JSON.stringify({
      title: "Alex",
      tagline: "t",
      owner: { name: "A B", nickname: "A", email: "alex@example.test" },
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
      displayCurrencies: ["CHF"],
      units: "metric",
      visibility: "public",
      features: {},
    }),
  );
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("the tell-by preference", { shuffle: false }, () => {
  test("never asked reads null; an answer is remembered and read back", async () => {
    const { readTellBy } = await import("@/lib/studio/tellBy");
    const { PATCH } = await import("@/app/api/web/[user]/studio/tell-by/route");
    expect(readTellBy(OWNER)).toBeNull();
    const response = await PATCH(req({ tellBy: "speak" }), { params });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, tellBy: "speak" });
    expect(readTellBy(OWNER)).toBe("speak");
    await PATCH(req({ tellBy: "type" }), { params });
    expect(readTellBy(OWNER)).toBe("type");
  });

  test("a bearer token is refused before the owner is asked about; a stranger writes nothing", async () => {
    const { readTellBy } = await import("@/lib/studio/tellBy");
    const { PATCH } = await import("@/app/api/web/[user]/studio/tell-by/route");
    expect((await PATCH(req({ tellBy: "speak" }, { authorization: "Bearer x" }), { params })).status).toBe(403);
    expect(isOwnerMock).not.toHaveBeenCalled();
    isOwnerMock.mockResolvedValue(false);
    expect((await PATCH(req({ tellBy: "speak" }), { params })).status).toBe(403);
    expect(readTellBy(OWNER)).toBeNull();
  });

  test("anything but the three answers is refused, naming them", async () => {
    const { PATCH } = await import("@/app/api/web/[user]/studio/tell-by/route");
    const response = await PATCH(req({ tellBy: "sing" }), { params });
    expect(response.status).toBe(400);
    expect((await response.json()).message).toContain("photos, speak, type");
  });
});

describe("assembleSpokenDay", () => {
  test("the corrected answers, in order, one paragraph each; skipped and blank ones left out", () => {
    expect(
      assembleSpokenDay({ how: " Tired but happy. ", did: "", ate: "Pastéis de nata.", funny: "A seagull stole my bread." }),
    ).toBe("Tired but happy.\n\nPastéis de nata.\n\nA seagull stole my bread.");
    expect(assembleSpokenDay({})).toBe("");
  });
});
