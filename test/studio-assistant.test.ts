import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";

/**
 * TIX-2 — the remembered answer to whether the owner wants the studio's
 * assistant offered on the add-a-day flow, mirroring `test/studio-tell-by
 * .test.ts` (B2194): owner cookie only, a bearer token refused before the
 * owner is even asked about, read back by `readAssistantChoice`.
 */

const OWNER = "alex";
let dir: string;
let isOwnerMock: ReturnType<typeof vi.fn>;

vi.mock("@/lib/contacts/session", () => ({ isOwner: vi.fn() }));

const params = Promise.resolve({ user: OWNER });
const req = (method: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request("https://t.test/api/web/alex/studio/assistant", {
    method,
    headers: { "content-type": "application/json", ...headers },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-studio-assistant-"));
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

describe("the assistant choice", { shuffle: false }, () => {
  test("never asked reads null; an answer is remembered and read back", async () => {
    const { readAssistantChoice } = await import("@/lib/studio/assistantChoice");
    const { GET, PATCH } = await import("@/app/api/web/[user]/studio/assistant/route");
    expect(readAssistantChoice(OWNER)).toBeNull();
    const first = await GET(req("GET", undefined), { params });
    expect(await first.json()).toEqual({ ok: true, assistant: null });

    const response = await PATCH(req("PATCH", { assistant: "on" }), { params });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, assistant: "on" });
    expect(readAssistantChoice(OWNER)).toBe("on");

    const second = await GET(req("GET", undefined), { params });
    expect(await second.json()).toEqual({ ok: true, assistant: "on" });

    await PATCH(req("PATCH", { assistant: "off" }), { params });
    expect(readAssistantChoice(OWNER)).toBe("off");
  });

  test("a bearer token is refused before the owner is asked about; a stranger writes nothing", async () => {
    const { readAssistantChoice } = await import("@/lib/studio/assistantChoice");
    const { GET, PATCH } = await import("@/app/api/web/[user]/studio/assistant/route");
    expect((await PATCH(req("PATCH", { assistant: "on" }, { authorization: "Bearer x" }), { params })).status).toBe(403);
    expect((await GET(req("GET", undefined, { authorization: "Bearer x" }), { params })).status).toBe(403);
    expect(isOwnerMock).not.toHaveBeenCalled();
    isOwnerMock.mockResolvedValue(false);
    expect((await PATCH(req("PATCH", { assistant: "on" }), { params })).status).toBe(403);
    expect(readAssistantChoice(OWNER)).toBeNull();
  });

  test("anything but on/off is refused, naming them", async () => {
    const { PATCH } = await import("@/app/api/web/[user]/studio/assistant/route");
    const response = await PATCH(req("PATCH", { assistant: "maybe" }), { params });
    expect(response.status).toBe(400);
    expect((await response.json()).message).toContain("on, off");
  });
});
