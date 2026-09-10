import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@/lib/photobook/orders", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/photobook/orders")>();
  return { ...actual, findSubmittedPrint: vi.fn() };
});
vi.mock("@/lib/photobook/reconcile", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/photobook/reconcile")>();
  return { ...actual, settleRefusedPrint: vi.fn() };
});

import { POST } from "@/app/api/webhooks/gelato/route";
import { findSubmittedPrint } from "@/lib/photobook/orders";
import { settleRefusedPrint } from "@/lib/photobook/reconcile";

const SECRET = "a-long-shared-secret-value";
const ORDER = "3f7c1d2e-9b0a-4c5d-8e6f-1a2b3c4d5e6f";

function hook(body: unknown, secret: string | null = SECRET): Request {
  return new Request("https://example.test/api/webhooks/gelato", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(secret === null ? {} : { "x-fernscout-webhook": secret }),
    },
    body: JSON.stringify(body),
  });
}

const REFUSED = {
  event: "order_status_updated",
  orderReferenceId: ORDER,
  fulfillmentStatus: "canceled",
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.GELATO_WEBHOOK_SECRET = SECRET;
  vi.mocked(findSubmittedPrint).mockResolvedValue({ owner: "severin", id: ORDER });
  vi.mocked(settleRefusedPrint).mockResolvedValue(true);
});

afterEach(() => {
  delete process.env.GELATO_WEBHOOK_SECRET;
});

/**
 * B1345. Gelato does not sign its webhooks — the shared header *is* the
 * credential — so these are not incidental checks on a parser. They are the
 * whole of what stands between the internet and a route that returns money.
 */
describe("the gelato webhook's door", () => {
  test("is not there at all without a configured secret", async () => {
    delete process.env.GELATO_WEBHOOK_SECRET;
    const response = await POST(hook(REFUSED));
    expect(response.status).toBe(404);
    expect(settleRefusedPrint).not.toHaveBeenCalled();
  });

  test("refuses a wrong secret, and a missing one, as 404 rather than 401", async () => {
    // 401 would tell whoever is knocking that they found the right address.
    for (const offered of ["not-the-secret", "", null]) {
      const response = await POST(hook(REFUSED, offered));
      expect(response.status).toBe(404);
    }
    expect(settleRefusedPrint).not.toHaveBeenCalled();
  });

  test("a secret that is a prefix of the real one is still wrong", async () => {
    const response = await POST(hook(REFUSED, SECRET.slice(0, -1)));
    expect(response.status).toBe(404);
    expect(settleRefusedPrint).not.toHaveBeenCalled();
  });
});

describe("what the gelato webhook acts on", () => {
  test("settles an order the printer has finally refused", async () => {
    const response = await POST(hook(REFUSED));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, settled: true });
    expect(settleRefusedPrint).toHaveBeenCalledWith("severin", ORDER, "canceled");
  });

  test("ignores every status that is not a terminal failure", async () => {
    // Refunding on one of these would be giving money back for a book that is
    // in the post.
    for (const status of ["created", "passed", "in_production", "printed", "shipped"]) {
      const response = await POST(hook({ ...REFUSED, fulfillmentStatus: status }));
      expect(response.status).toBe(200);
    }
    expect(settleRefusedPrint).not.toHaveBeenCalled();
  });

  test("ignores the item-level event, so one book is not settled twice", async () => {
    const response = await POST(hook({ ...REFUSED, event: "order_item_status_updated" }));
    expect(response.status).toBe(200);
    expect(settleRefusedPrint).not.toHaveBeenCalled();
  });

  test("answers 200 for an order it does not know, so Gelato stops retrying", async () => {
    vi.mocked(findSubmittedPrint).mockResolvedValue(null);
    const response = await POST(hook(REFUSED));
    expect(response.status).toBe(200);
    expect(settleRefusedPrint).not.toHaveBeenCalled();
  });

  test("refuses a reference that is not an order id before it reaches a query", async () => {
    const response = await POST(hook({ ...REFUSED, orderReferenceId: "../../etc/passwd" }));
    expect(response.status).toBe(200);
    expect(findSubmittedPrint).not.toHaveBeenCalled();
  });
});
