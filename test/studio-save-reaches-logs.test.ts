import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/capabilities", async (orig) => ({
  ...(await orig<typeof import("../lib/capabilities")>()),
  isEnabled: (name: string) => name === "logging",
}));

// No cookie: the owner gate refuses, which is the failed save we want logged.
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers(),
}));

import { PATCH } from "../app/api/helper/[user]/day/route";
import { parseLogEntries } from "../lib/adminLogs";

describe("a refused studio save reaches /admin Logs (B-3008)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("leaves a [req] line the Logs page shows for that journal", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const request = new Request("http://localhost/api/helper/somebody/day", {
      method: "PATCH",
      headers: { "content-type": "application/json", "x-request-id": "b3008aaa" },
      body: JSON.stringify({ trip: "t", slug: "s", text: "words" }),
    });
    const response = await PATCH(request, { params: Promise.resolve({ user: "somebody" }) } as never);
    expect(response.status).toBeGreaterThanOrEqual(400);

    const line = log.mock.calls.map((c) => String(c[0])).find((l) => l.startsWith("[req] b3008aaa"));
    expect(line).toBeDefined();
    const [entry] = parseLogEntries(JSON.stringify({ MESSAGE: line, __REALTIME_TIMESTAMP: "1760800000000000" }));
    expect(entry).toMatchObject({ kind: "req", journal: "somebody", level: "warn" });
    expect(entry.title).toContain("PATCH /api/helper/[user]/day");
  });
});
