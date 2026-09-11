import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { buildStannpRequest, type PostcardOrder } from "@/lib/postcard/providers";
import { fetchStannpStatus, sendPostcard } from "@/lib/postcard/stannp";

const ORDER: PostcardOrder = {
  to: {
    name: "Maria Muster",
    line1: "Bahnhofstrasse 12",
    postcode: "8001",
    city: "Zurich",
    country: "CH",
  },
  front: new Uint8Array([1, 2, 3]),
  back: new Uint8Array([4, 5, 6]),
  test: true,
  paymentRef: "test-payment-ref",
};

describe("postcard provider requests", () => {
  test("builds a request when a payment is on file", () => {
    const request = buildStannpRequest(ORDER);
    expect(request.provider).toBe("stannp");
    expect(request.fields["recipient[postcode]"]).toBe("8001");
  });

  test("uses the field names Stannp actually documents — B435", () => {
    const request = buildStannpRequest(ORDER);
    expect(request.url).toBe("https://api-eu1.stannp.com/v1/postcards/create");
    // `town` is what this was written with and is not a field Stannp knows;
    // an unrecognised one is dropped in silence, so the card would have gone
    // out with no city on it.
    expect(request.fields["recipient[city]"]).toBe("Zurich");
    expect(request.fields["recipient[town]"]).toBeUndefined();
    // Without this they lay a white border over art rendered to the bleed.
    expect(request.fields.padding).toBe("0");
  });

  test("refuses to build a request without a recorded payment — B07", () => {
    const unpaid: PostcardOrder = { ...ORDER, paymentRef: "" };
    expect(() => buildStannpRequest(unpaid)).toThrow(/no recorded payment/);
  });
});


/**
 * The client, against a stubbed `fetch`. Never the network: a test that could
 * reach Stannp is a test that could cost money on somebody's CI run.
 */
describe("sending to Stannp", () => {
  const input = { to: ORDER.to, front: ORDER.front, back: ORDER.back, paymentRef: "order-1" };

  beforeEach(() => {
    process.env.STANNP_API_KEY = "key-under-test";
  });

  afterEach(() => {
    delete process.env.STANNP_API_KEY;
    vi.unstubAllGlobals();
  });

  function stub(response: unknown, ok = true) {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(response), { status: ok ? 200 : 402 }));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  test("refuses with no key rather than half-running", async () => {
    delete process.env.STANNP_API_KEY;
    const fetchMock = stub({});
    expect(await sendPostcard(input)).toEqual({ ok: false, error: "STANNP_API_KEY is not set" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("refuses an order with no recorded payment — B07", async () => {
    const fetchMock = stub({});
    const result = await sendPostcard({ ...input, paymentRef: "" });
    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("test mode is the default, and both sides go up as files", async () => {
    const fetchMock = stub({ success: true, data: { id: 4321, pdf: "https://…/sample.pdf", cost: "0.88" } });
    const result = await sendPostcard(input);

    expect(result).toMatchObject({ ok: true, ref: "stannp-test:4321" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api-eu1.stannp.com/v1/postcards/create");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      `Basic ${Buffer.from("key-under-test:").toString("base64")}`,
    );
    const body = init.body as FormData;
    // Absent `features.postcards.live` means a sample render and no dispatch.
    // This is the assertion that keeps the default free.
    expect(body.get("test")).toBe("true");
    expect(body.get("size")).toBe("A6");
    expect(body.get("padding")).toBe("0");
    expect(body.get("front")).toBeInstanceOf(Blob);
    expect(body.get("back")).toBeInstanceOf(Blob);
  });

  // The bug that made every free sample look like a refusal — B435. Stannp
  // answers a test render with `"id": 0`, and `!payload.data?.id` is true for
  // zero, so a card that had rendered perfectly was recorded as failed and its
  // credits given back.
  test("id 0 is an id — a test render is not a refusal", async () => {
    stub({ success: true, data: { id: 0, pdf: "https://…/sample.pdf", cost: "1.86", status: "test" } });
    expect(await sendPostcard(input)).toMatchObject({ ok: true, ref: "stannp-test:0" });
  });

  test("a refusal says what the server said, never a bare status", async () => {
    // Their failures come back 200 with the explanation in the body, so a
    // message built from the status code alone threw away the only useful
    // sentence in the response.
    stub({ success: false, error: "Failed to download the front image from the URL provided" });
    const result = await sendPostcard(input);
    expect(result).toEqual({
      ok: false,
      error: "stannp refused: Failed to download the front image from the URL provided",
    });
  });

  test("a refusal is an error, not a reported send", async () => {
    stub({ success: false, error: "Insufficient balance" }, false);
    expect(await sendPostcard(input)).toEqual({ ok: false, error: "stannp refused: Insufficient balance" });
  });

  test("an unreachable host does not throw out of the loop", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNREFUSED"); }));
    const result = await sendPostcard(input);
    expect(result.ok).toBe(false);
  });
});

/**
 * `fetchStannpStatus` — B1548. Confirmed live against mailpiece 215161865:
 * the id goes in the path (`/get/<id>`), not `?id=` (which answers "Missing
 * resource ID"), and the response shape below is exactly what Stannp
 * returned.
 */
describe("fetching a card's status from Stannp", () => {
  beforeEach(() => {
    process.env.STANNP_API_KEY = "key-under-test";
  });

  afterEach(() => {
    delete process.env.STANNP_API_KEY;
    vi.unstubAllGlobals();
  });

  function stub(response: unknown, ok = true) {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(response), { status: ok ? 200 : 402 }));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  test("asks by id in the path, not a query parameter", async () => {
    const fetchMock = stub({ success: true, data: { id: 215161865, status: "received" } });
    expect(await fetchStannpStatus("stannp:215161865")).toBe("received");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api-eu1.stannp.com/v1/postcards/get/215161865");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      `Basic ${Buffer.from("key-under-test:").toString("base64")}`,
    );
  });

  test("reads a test-mode ref the same way", async () => {
    stub({ success: true, data: { id: 4321, status: "printing" } });
    expect(await fetchStannpStatus("stannp-test:4321")).toBe("printing");
  });

  // The boundary the whole feature exists to keep: this system has decided
  // it will never claim to know a card was delivered.
  test("never reports delivered, local_delivery or returned", async () => {
    for (const word of ["delivered", "local_delivery", "returned"]) {
      stub({ success: true, data: { id: 1, status: word } });
      expect(await fetchStannpStatus("stannp:1")).toBeNull();
    }
  });

  test("null with no key, a bad ref, a refusal or a network failure", async () => {
    delete process.env.STANNP_API_KEY;
    expect(await fetchStannpStatus("stannp:1")).toBeNull();

    process.env.STANNP_API_KEY = "key-under-test";
    expect(await fetchStannpStatus("dry-run:1")).toBeNull();

    stub({ success: false, error: "not found" }, false);
    expect(await fetchStannpStatus("stannp:1")).toBeNull();

    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNREFUSED"); }));
    expect(await fetchStannpStatus("stannp:1")).toBeNull();
  });
});
