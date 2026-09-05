import { describe, expect, test, vi, beforeEach } from "vitest";

vi.mock("@/lib/contacts/session", () => ({ isOwner: vi.fn().mockResolvedValue(true) }));
vi.mock("@/lib/capabilities", () => ({ isEnabled: vi.fn().mockReturnValue(true) }));
vi.mock("@/lib/credits", () => ({
  spend: vi.fn(),
  refund: vi.fn(),
  balanceOf: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/photobook/receipt", () => ({ sendPhotobookReceipt: vi.fn() }));
// Partial mocks — both modules export helpers the *other* describe block
// below (the download route) still needs for real: `ORDER_ID_RE` and
// `orderDir` are exercised as themselves, only the three calls that plan,
// price and render a book are replaced.
vi.mock("@/lib/photobook/build", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/photobook/build")>();
  return { ...actual, planFor: vi.fn(), priceOf: vi.fn(), buildPhotobook: vi.fn() };
});
vi.mock("@/lib/photobook/orders", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/photobook/orders")>();
  return { ...actual, claimOrder: vi.fn(), markFailed: vi.fn(), markPrinted: vi.fn() };
});

import { POST } from "@/app/[user]/photobook/order/route";
import { GET } from "@/app/[user]/photobooks/[id]/[file]/route";
import { refund, spend } from "@/lib/credits";
import { planFor, priceOf, buildPhotobook } from "@/lib/photobook/build";
import { claimOrder, markFailed } from "@/lib/photobook/orders";

const params = Promise.resolve({ user: "alex" });

/** A book just real enough for `pages`/`volumes` to sum without throwing —
 * the layout itself is `planFor`'s business, not this route's. */
const BOOK = { volumes: [{ interiorPages: 40 }], warnings: [], photoCount: 12 };
const CREDITS = 88;

function orderRequest(orderId: string) {
  return new Request("https://example.test/alex/photobook/order", {
    method: "POST",
    body: new URLSearchParams({
      trip: "alex/asia-2026",
      orderId,
      options: JSON.stringify({
        size: "square-210",
        // Required since the book learned to be printed in a language.
        // `parseOptions` rejects a body without it rather than defaulting,
        // which is why leaving it out here failed with a 400 rather than a 303.
        locale: "en",
        binding: "perfect",
        excludePhotos: [],
        includeText: true,
        includeMap: true,
        includeChapters: true,
        includeNames: true,
        includeCosts: true,
      }),
    }),
  });
}

describe("the order route", () => {
  test("a bearer token is refused — an agent never spends credits", async () => {
    const request = new Request("https://example.test/alex/photobook/order", {
      method: "POST",
      headers: { authorization: "Bearer whatever" },
      body: new URLSearchParams({ trip: "alex/asia-2026", orderId: "abc12345", options: "{}" }),
    });
    const response = await POST(request, { params });
    expect(response.status).toBe(403);
  });

  describe("the money path — claim, spend, build, and what unwinds when it doesn't", () => {
    beforeEach(() => {
      vi.clearAllMocks();
      vi.mocked(planFor).mockReturnValue(BOOK as never);
      vi.mocked(priceOf).mockReturnValue(CREDITS);
      vi.mocked(claimOrder).mockResolvedValue(true);
      vi.mocked(markFailed).mockResolvedValue(true);
      vi.mocked(refund).mockResolvedValue(undefined);
    });

    test("a build that throws is refunded for exactly what was spent, and marked failed", async () => {
      vi.mocked(spend).mockResolvedValue(true);
      vi.mocked(buildPhotobook).mockImplementation(() => {
        throw new Error("no ICC profile for this size");
      });

      const response = await POST(orderRequest("order-build-fails"), { params });

      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toContain("state=failed");
      // The same `credits` the order was priced and spent at — a refund for
      // any other number would either shortchange the owner or hand back
      // more than was ever taken.
      expect(refund).toHaveBeenCalledWith("alex", CREDITS, "order-build-fails");
      expect(markFailed).toHaveBeenCalledWith(
        "alex",
        "order-build-fails",
        expect.any(Object),
        expect.any(String),
      );
    });

    test("no credits, no build — spend refusing the charge stops the pipeline before a page is drawn", async () => {
      vi.mocked(spend).mockResolvedValue(false);

      const response = await POST(orderRequest("order-no-credits"), { params });

      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toContain("state=no_credits");
      expect(buildPhotobook).not.toHaveBeenCalled();
      expect(refund).not.toHaveBeenCalled();
      expect(markFailed).toHaveBeenCalledWith(
        "alex",
        "order-no-credits",
        expect.any(Object),
        "no_credits",
      );
    });
  });
});

describe("the download route", () => {
  test("a filename cannot climb out of the order's directory", async () => {
    const response = await GET(new Request("https://example.test/x"), {
      params: Promise.resolve({ user: "alex", id: "abc12345", file: "../../../etc/passwd" }),
    });
    expect(response.status).toBe(404);
  });

  test("only the two shapes of file this feature writes are served", async () => {
    const response = await GET(new Request("https://example.test/x"), {
      params: Promise.resolve({ user: "alex", id: "abc12345", file: "notes.txt" }),
    });
    expect(response.status).toBe(404);
  });
});
