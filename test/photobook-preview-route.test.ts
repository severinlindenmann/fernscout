import { describe, expect, test, vi } from "vitest";

vi.mock("@/lib/contacts/session", () => ({ isOwner: vi.fn().mockResolvedValue(true) }));
import { POST } from "@/app/[user]/photobook/preview/route";
import { DEFAULT_OPTIONS } from "@/lib/photobook/options";

const params = Promise.resolve({ user: "alex" });

describe("the preview route", () => {
  test("an agent's bearer token is refused outright, not silently ignored", async () => {
    const request = new Request("https://example.test/alex/photobook/preview", {
      method: "POST",
      headers: { authorization: "Bearer whatever", "content-type": "application/json" },
      body: JSON.stringify({ trip: "alex/asia-2026", options: DEFAULT_OPTIONS }),
    });
    const response = await POST(request, { params });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "not_for_agents" });
  });

  test("a body that is not options is refused rather than defaulted", async () => {
    const request = new Request("https://example.test/alex/photobook/preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ trip: "../../etc", options: DEFAULT_OPTIONS }),
    });
    const response = await POST(request, { params });
    expect(response.status).toBe(404);
  });
});
