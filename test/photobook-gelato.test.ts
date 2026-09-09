import { beforeEach, describe, expect, it, vi } from "vitest";
import { quoteBook, submitBookPrint, fetchOrderStatus } from "../lib/photobook/gelato";
import type { BookOrder } from "../lib/photobook/providers";

const INPUT = { productUid: "book-uid", pageCount: 52, country: "CH", currency: "CHF" };

const ORDER: BookOrder = {
  reference: "order-1",
  title: "A trip",
  interiorUrl: "https://example.com/interior.pdf",
  coverUrl: "https://example.com/cover.pdf",
  pageCount: 52,
  trimWidthMm: 200,
  trimHeightMm: 200,
  copies: 1,
  to: {
    name: "Jane Doe",
    line1: "Bahnhofstrasse 1",
    postcode: "8001",
    city: "Zurich",
    country: "CH",
    email: "jane@example.com",
  },
  test: true,
  productUid: "book-uid",
  shipmentMethodUid: "swiss_post_economy",
  paymentRef: "ledger-1",
};

const QUOTE_BODY = {
  quotes: [
    {
      products: [{ itemReferenceId: "i1", price: 14.4, currency: "CHF" }],
      shipmentMethods: [
        { shipmentMethodUid: "swiss_post_economy", price: 8.52, currency: "CHF", minDeliveryDays: 4 },
        { shipmentMethodUid: "swiss_post_priority", price: 10.64, currency: "CHF", minDeliveryDays: 3 },
      ],
      expirationDateTime: "2026-09-08T17:17:37+00:00",
    },
  ],
  errors: [],
};

beforeEach(() => {
  process.env.GELATO_API_KEY = "test-key";
  vi.restoreAllMocks();
});

describe("quoteBook", () => {
  it("refuses to call anybody without a key", async () => {
    delete process.env.GELATO_API_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await quoteBook(INPUT)).toEqual({ error: "no_key" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("takes the cheapest shipment method and returns minor units", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(QUOTE_BODY), { status: 200 })));
    const result = await quoteBook(INPUT);
    expect(result).toMatchObject({
      printMinor: 1440,
      shipMinor: 852,
      currency: "CHF",
      shipmentMethodUid: "swiss_post_economy",
      expiresAt: "2026-09-08T17:17:37+00:00",
    });
  });

  it("reports a refusal rather than throwing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response('{"code":"BAD_REQUEST"}', { status: 400 })));
    expect(await quoteBook(INPUT)).toEqual({ error: "refused" });
  });

  it("reports an unreachable provider rather than throwing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
    );
    expect(await quoteBook(INPUT)).toEqual({ error: "unreachable" });
  });

  it("sends the key in the header and never in the body", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(QUOTE_BODY), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await quoteBook(INPUT);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit & { headers: Record<string, string> }];
    expect(init.headers["X-API-KEY"]).toBe("test-key");
    expect(init.body).not.toContain("test-key");
  });
});

describe("submitBookPrint", () => {
  it("sends a draft unless the journal is live, and never prints on a draft", async () => {
    const fetchMock = vi.fn(async () => new Response('{"id":"gel-1"}', { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    await submitBookPrint({ ...ORDER, test: true });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.orderType).toBe("draft");
  });

  it("never puts the key in the body", async () => {
    const fetchMock = vi.fn(async () => new Response('{"id":"gel-1"}', { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    await submitBookPrint(ORDER);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit & { headers: Record<string, string> }];
    expect(init.body).not.toContain("test-key");
    expect(init.headers["X-API-KEY"]).toBe("test-key");
  });

  it("returns the provider's order id as providerRef", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response('{"id":"gel-1"}', { status: 201 })));
    expect(await submitBookPrint(ORDER)).toEqual({ providerRef: "gel-1" });
  });

  it("refuses without a key and calls nothing", async () => {
    delete process.env.GELATO_API_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await submitBookPrint(ORDER)).toEqual({ error: "no_key" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports a refusal rather than throwing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response('{"code":"BAD_REQUEST"}', { status: 400 })));
    expect(await submitBookPrint(ORDER)).toEqual({ error: "refused" });
  });

  it("reports an unreachable provider rather than throwing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
    );
    expect(await submitBookPrint(ORDER)).toEqual({ error: "unreachable" });
  });
});

describe("fetchOrderStatus", () => {
  it("reads a status back", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response('{"fulfillmentStatus":"printed"}', { status: 200 })));
    expect(await fetchOrderStatus("gel-1")).toBe("printed");
  });

  it("answers null rather than throwing when the provider is unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
    );
    expect(await fetchOrderStatus("gel-1")).toBeNull();
  });

  it("answers null with no key, and calls nothing", async () => {
    delete process.env.GELATO_API_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await fetchOrderStatus("gel-1")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
