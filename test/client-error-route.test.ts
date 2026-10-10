import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "../app/api/v2/client-error/route";

const valid = { message: "boom", route: "/at/x", appVersion: "abc123", platform: "web" as const };
let n = 0;
const call = (body: unknown, ip = `203.0.113.${++n}`) =>
  POST(
    new Request("http://localhost/api/v2/client-error", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );

let spy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  spy = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => spy.mockRestore());

describe("POST /api/v2/client-error", () => {
  it("answers 204 and logs exactly one line group", async () => {
    const res = await call({ ...valid, requestId: "ab12cd34", stack: "Error: boom\n  at f (/a.js:1:1)" });
    expect(res.status).toBe(204);
    expect(spy).toHaveBeenCalledTimes(1);
    const out = String(spy.mock.calls[0][0]);
    expect(out.split("\n")[0]).toBe('[client-error] ab12cd34 web abc123 /at/x "boom"');
    expect(out).toContain("\n    Error: boom");
  });

  it("redacts an email and a bearer token inside a stack, and shows no IP", async () => {
    await call({ ...valid, stack: "at f (user jo@example.com)\nBearer abc123secret" }, "198.51.100.77");
    const out = String(spy.mock.calls[0][0]);
    expect(out).not.toContain("jo@example.com");
    expect(out).not.toContain("abc123secret");
    expect(out).not.toContain("198.51.100.77");
  });

  it("refuses an oversize body with 413", async () => {
    const res = await call({ ...valid, stack: "x".repeat(20 * 1024) });
    expect(res.status).toBe(413);
    expect(spy).not.toHaveBeenCalled();
  });

  it("keeps at most 12 stack lines, so one report cannot flood the log", async () => {
    const res = await call({ ...valid, stack: Array.from({ length: 500 }, () => "a").join("\n") }, "192.0.2.201");
    expect(res.status).toBe(204);
    expect(String(spy.mock.calls[0][0]).split("\n")).toHaveLength(13);
  });

  it("refuses an invalid body with the error envelope", async () => {
    const res = await call({ ...valid, platform: "android" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_request");
  });

  it("limits a flood to 30 per client with 429", async () => {
    const ip = "192.0.2.200";
    const statuses: number[] = [];
    for (let i = 0; i < 31; i++) statuses.push((await call(valid, ip)).status);
    expect(statuses.slice(0, 30).every((s) => s === 204)).toBe(true);
    expect(statuses[30]).toBe(429);
  });
});
