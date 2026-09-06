import { describe, expect, test } from "vitest";

import { buildStannpRequest, type PostcardOrder } from "@/lib/postcard/providers";

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

  test("refuses to build a request without a recorded payment — B07", () => {
    const unpaid: PostcardOrder = { ...ORDER, paymentRef: "" };
    expect(() => buildStannpRequest(unpaid)).toThrow(/no recorded payment/);
  });
});
