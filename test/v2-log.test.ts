import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let logging = true;
vi.mock("../lib/capabilities", () => ({ isEnabled: () => logging }));

import { fail, ok, withV2Log as wrapV2 } from "../lib/api/v2/route";

type H = (r: Request, c: unknown) => Promise<Response>;
const withV2Log = (fn: () => Promise<Response>, o: { route: string }) => wrapV2(fn as unknown as H, o);

const ROUTE = "/api/v2/[user]/figures";
const req = (url = "http://x/api/v2/alice/figures?limit=5&email=a@b.co") =>
  new Request(url, { headers: { "x-request-id": "abcd1234" } });
const ctx = { params: Promise.resolve({ user: "alice" }) };

let logs: string[];
let errors: string[];
beforeEach(() => {
  logging = true;
  logs = [];
  errors = [];
  vi.spyOn(console, "log").mockImplementation((...a) => void logs.push(String(a[0])));
  vi.spyOn(console, "error").mockImplementation((...a) => void errors.push(String(a[0])));
});
afterEach(() => vi.restoreAllMocks());

describe("withV2Log", () => {
  it("logs one [req] line with id, method, template, status, ms, journal and error code", async () => {
    const h = withV2Log(async () => fail("not_found", "nope"), { route: ROUTE });
    const res = await h(req(), ctx);
    expect(res.status).toBe(404);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatch(/^\[req\] abcd1234 GET \/api\/v2\/\[user\]\/figures 404 \d+ms journal=alice err=not_found$/);
    expect(logs[0]).not.toContain("limit");
    expect(logs[0]).not.toContain("a@b.co");
    expect(await res.json()).toMatchObject({ error: "not_found" }); // body still readable
  });

  it("logs err=- on success and - for a missing id or journal", async () => {
    const h = withV2Log(async () => ok({ a: 1 }), { route: ROUTE });
    await h(new Request("http://x/a"), {});
    expect(logs[0]).toMatch(/^\[req\] - GET \S+ 200 \d+ms journal=- err=-$/);
  });

  it("logs [req-error] with a scrubbed stack and rethrows", async () => {
    const boom = new Error("failed for me@example.com with Bearer abc.def.ghi");
    const h = withV2Log(
      async () => {
        throw boom;
      },
      { route: ROUTE },
    );
    await expect(h(req(), ctx)).rejects.toBe(boom);
    expect(logs).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("[req-error] abcd1234 GET /api/v2/[user]/figures");
    expect(errors[0]).toContain("\n    ");
    expect(errors[0]).not.toContain("me@example.com");
    expect(errors[0]).not.toContain("abc.def.ghi");
  });

  it("says nothing on success when logging is off, but still logs errors", async () => {
    logging = false;
    await withV2Log(async () => ok({}), { route: ROUTE })(req(), ctx);
    expect(logs).toEqual([]);
    const h = withV2Log(
      async () => {
        throw new Error("x");
      },
      { route: ROUTE },
    );
    await expect(h(req(), ctx)).rejects.toThrow("x");
    expect(errors).toHaveLength(1);
  });

  it("never throws from the logging itself", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {
      throw new Error("stdout gone");
    });
    const res = await withV2Log(async () => ok({}), { route: ROUTE })(req(), ctx);
    expect(res.status).toBe(200);
  });
});
