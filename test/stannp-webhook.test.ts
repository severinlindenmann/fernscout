import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@/lib/postcard/orders", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/postcard/orders")>();
  return { ...actual, recordProviderCancellation: vi.fn() };
});

import { POST } from "@/app/api/webhooks/stannp/route";
import { recordProviderCancellation } from "@/lib/postcard/orders";

const SECRET = "a-long-shared-secret-value";

function sign(body: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(body).digest("hex");
}

function hook(body: unknown, secret: string | null = SECRET): Request {
  const raw = JSON.stringify(body);
  return new Request("https://example.test/api/webhooks/stannp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(secret === null ? {} : { "x-stannp-signature": sign(raw, secret) }),
    },
    body: raw,
  });
}

const CANCELLED = {
  event: "mailpiece_status",
  webhook_id: 1234,
  created: "2026-09-11 20:00:00",
  retries: 0,
  mailpieces: [{ id: 555, status: "cancelled" }],
};

const DISPATCHED = {
  event: "mailpiece_status",
  webhook_id: 1234,
  created: "2026-09-11 20:00:00",
  retries: 0,
  mailpieces: [{ id: 555, status: "dispatched" }],
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.STANNP_WEBHOOK_SECRET = SECRET;
});

afterEach(() => {
  delete process.env.STANNP_WEBHOOK_SECRET;
});

describe("POST /api/webhooks/stannp", () => {
  test("no secret configured — 404, nothing read", async () => {
    delete process.env.STANNP_WEBHOOK_SECRET;
    const res = await POST(hook(CANCELLED));
    expect(res.status).toBe(404);
    expect(recordProviderCancellation).not.toHaveBeenCalled();
  });

  test("missing signature header — 404", async () => {
    const res = await POST(hook(CANCELLED, null));
    expect(res.status).toBe(404);
    expect(recordProviderCancellation).not.toHaveBeenCalled();
  });

  test("wrong signature — 404", async () => {
    const res = await POST(hook(CANCELLED, "a-different-secret"));
    expect(res.status).toBe(404);
    expect(recordProviderCancellation).not.toHaveBeenCalled();
  });

  test("malformed JSON — 400", async () => {
    const raw = "{not json";
    const req = new Request("https://example.test/api/webhooks/stannp", {
      method: "POST",
      headers: { "content-type": "application/json", "x-stannp-signature": sign(raw, SECRET) },
      body: raw,
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  test("a non-mailpiece_status event is acknowledged and ignored", async () => {
    const res = await POST(hook({ event: "campaign_status", mailpieces: [] }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, ignored: "event" });
    expect(recordProviderCancellation).not.toHaveBeenCalled();
  });

  test("a cancelled mailpiece records the cancellation against both ref forms until one matches", async () => {
    vi.mocked(recordProviderCancellation).mockImplementation(async (ref) => ref === "stannp:555");
    const res = await POST(hook(CANCELLED));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, cancelled: 1, ignored: 0 });
    expect(recordProviderCancellation).toHaveBeenCalledWith("stannp:555");
  });

  test("a cancelled mailpiece matching no known order is acknowledged, not retried", async () => {
    vi.mocked(recordProviderCancellation).mockResolvedValue(false);
    const res = await POST(hook(CANCELLED));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, cancelled: 0, ignored: 1 });
  });

  test("any status other than cancelled is acknowledged and never stored — the delivery-tracking boundary", async () => {
    const res = await POST(hook(DISPATCHED));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, cancelled: 0, ignored: 1 });
    expect(recordProviderCancellation).not.toHaveBeenCalled();
  });

  test("a mailpiece with no id is ignored", async () => {
    const res = await POST(hook({ event: "mailpiece_status", mailpieces: [{ status: "cancelled" }] }));
    expect(await res.json()).toEqual({ ok: true, cancelled: 0, ignored: 1 });
    expect(recordProviderCancellation).not.toHaveBeenCalled();
  });
});
