import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@/lib/photobook/orders", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/photobook/orders")>();
  return { ...actual, findSubmittedPrint: vi.fn(), recordTracking: vi.fn() };
});
vi.mock("@/lib/photobook/reconcile", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/photobook/reconcile")>();
  return { ...actual, settleRefusedPrint: vi.fn() };
});
vi.mock("@/lib/photobook/receipt", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/photobook/receipt")>();
  return { ...actual, sendPhotobookShipped: vi.fn() };
});
vi.mock("@/lib/trips", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/trips")>();
  return { ...actual, getTrip: vi.fn(() => ({ title: "Alps 2024" })) };
});

import { POST } from "@/app/api/webhooks/gelato/route";
import { findSubmittedPrint, recordTracking } from "@/lib/photobook/orders";
import { settleRefusedPrint } from "@/lib/photobook/reconcile";
import { sendPhotobookShipped } from "@/lib/photobook/receipt";

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

// The real payload from the ticket: two fulfillments on one item.
const SHIPPED_TWO_PARCELS = {
  event: "order_status_updated",
  orderReferenceId: ORDER,
  fulfillmentStatus: "shipped",
  items: [
    {
      itemReferenceId: "item-1",
      fulfillmentStatus: "shipped",
      fulfillments: [
        {
          trackingCode: "code123",
          trackingUrl: "http://example.com/tracking?code=code123",
          shipmentMethodName: "DHL Express Domestic BR",
        },
        {
          trackingCode: "code234",
          trackingUrl: "http://example.com/tracking?code=code234",
          shipmentMethodName: "DHL Express Domestic BR",
        },
      ],
    },
  ],
};

const TRACKING_CODE_EVENT = {
  event: "order_item_tracking_code_updated",
  orderId: "a6a1f9ce-…",
  orderReferenceId: ORDER,
  trackingCode: "code123",
  trackingUrl: "http://example.com/tracking?code=code123",
  shipmentMethodName: "DHL Express Domestic BR",
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.GELATO_WEBHOOK_SECRET = SECRET;
  vi.mocked(findSubmittedPrint).mockResolvedValue({ owner: "severin", id: ORDER });
  vi.mocked(settleRefusedPrint).mockResolvedValue(true);
  vi.mocked(recordTracking).mockResolvedValue({
    payload: { trip: "severin/alps", options: {} as never, pages: 0, volumes: 1, credits: 0 },
    sendMail: true,
  });
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

  test("ignores every status that is not a terminal failure or shipped, and stores nothing", async () => {
    // Refunding on one of these would be giving money back for a book that is
    // in the post; the order page already asks Gelato directly for these.
    for (const status of ["created", "passed", "in_production", "printed"]) {
      const response = await POST(hook({ ...REFUSED, fulfillmentStatus: status }));
      expect(response.status).toBe(200);
    }
    expect(settleRefusedPrint).not.toHaveBeenCalled();
    expect(recordTracking).not.toHaveBeenCalled();
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

/**
 * B1440. Two fulfillments on one item, a duplicate delivery, and the
 * dedicated tracking-code event that arrives independently.
 */
describe("shipped", () => {
  test("stores every fulfillment across every item and sends one mail", async () => {
    const response = await POST(hook(SHIPPED_TWO_PARCELS));
    expect(response.status).toBe(200);
    expect(recordTracking).toHaveBeenCalledWith(
      "severin",
      ORDER,
      [
        { code: "code123", url: "http://example.com/tracking?code=code123", carrier: "DHL Express Domestic BR" },
        { code: "code234", url: "http://example.com/tracking?code=code234", carrier: "DHL Express Domestic BR" },
      ],
      true,
    );
    expect(sendPhotobookShipped).toHaveBeenCalledTimes(1);
  });

  test("delivered twice sends one mail, because the second delivery finds it already sent", async () => {
    await POST(hook(SHIPPED_TWO_PARCELS));
    // The second delivery: `recordTracking` reports the mail was already
    // sent, exactly as the real implementation would after its own
    // compare-and-swap finds `shippedAt` already set.
    vi.mocked(recordTracking).mockResolvedValueOnce({
      payload: { trip: "severin/alps", options: {} as never, pages: 0, volumes: 1, credits: 0 },
      sendMail: false,
    });
    const response = await POST(hook(SHIPPED_TWO_PARCELS));
    expect(response.status).toBe(200);
    expect(sendPhotobookShipped).toHaveBeenCalledTimes(1);
  });

  test("the dedicated tracking-code event stores tracking and never mails", async () => {
    const response = await POST(hook(TRACKING_CODE_EVENT));
    expect(response.status).toBe(200);
    expect(recordTracking).toHaveBeenCalledWith(
      "severin",
      ORDER,
      [{ code: "code123", url: "http://example.com/tracking?code=code123", carrier: "DHL Express Domestic BR" }],
      false,
    );
    expect(sendPhotobookShipped).not.toHaveBeenCalled();
  });
});
