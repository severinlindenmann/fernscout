import { describe, expect, test, vi, beforeEach } from "vitest";

vi.mock("@/lib/contacts/session", () => ({ isOwner: vi.fn().mockResolvedValue(true) }));
vi.mock("@/lib/capabilities", () => ({ isEnabled: vi.fn().mockReturnValue(true) }));
vi.mock("@/lib/credits", () => ({
  spend: vi.fn(),
  balanceOf: vi.fn().mockResolvedValue(null),
  // The route asks the storage guard before it claims an order (B661), and
  // that reads the ledger for storage purchases. Zero: these fixtures have no
  // ceiling to be near, so the guard passes and the money path below is what
  // is under test, unchanged.
  countSpends: vi.fn().mockResolvedValue(0),
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
import { balanceOf, spend } from "@/lib/credits";
import { planFor, priceOf, buildPhotobook } from "@/lib/photobook/build";
import { claimOrder, markFailed, markPrinted } from "@/lib/photobook/orders";

const params = Promise.resolve({ user: "alex" });

/** A book just real enough for `pages`/`volumes` to sum without throwing —
 * the layout itself is `planFor`'s business, not this route's. */
const BOOK = { volumes: [{ interiorPages: 40 }], warnings: [], photoCount: 12 };
const CREDITS = 88;

function orderRequest(orderId: string, previewedCredits: string = String(CREDITS)) {
  return new Request("https://example.test/alex/photobook/order", {
    method: "POST",
    body: new URLSearchParams({
      trip: "alex/asia-2026",
      orderId,
      previewedCredits,
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
        includeCharts: false,
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

  describe("the money path — claim, build, charge, and what happens when it does not finish", () => {
    beforeEach(() => {
      vi.clearAllMocks();
      vi.mocked(planFor).mockReturnValue(BOOK as never);
      vi.mocked(priceOf).mockReturnValue(CREDITS);
      vi.mocked(claimOrder).mockResolvedValue(true);
      vi.mocked(markFailed).mockResolvedValue(true);
      vi.mocked(markPrinted).mockResolvedValue(true);
      vi.mocked(balanceOf).mockResolvedValue(CREDITS * 4);
    });

    /**
     * B509. The order used to spend and then build, so anything that ended the
     * request in the tens of seconds a build takes — a deploy restarting the
     * service, a proxy timeout — took the money and left no book and no
     * refund, because the code that would have given it back died with the
     * request. It cost 357 credits on the live instance in one afternoon.
     *
     * Reversed, the worst case is a book nobody paid for. These tests are the
     * ordering, which is the whole of the fix.
     */
    test("a build that throws costs nothing, because nothing was charged yet", async () => {
      vi.mocked(buildPhotobook).mockImplementation(() => {
        throw new Error("no ICC profile for this size");
      });

      const response = await POST(orderRequest("order-build-fails"), { params });

      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toContain("state=failed");
      expect(spend).not.toHaveBeenCalled();
      expect(markFailed).toHaveBeenCalledWith(
        "alex",
        "order-build-fails",
        expect.any(Object),
        expect.any(String),
      );
    });

    test("the book is built before a single credit moves", async () => {
      const calls: string[] = [];
      vi.mocked(buildPhotobook).mockImplementation(() => {
        calls.push("build");
        return { files: ["book-interior.pdf"], pages: 52, volumes: 1, missing: [] };
      });
      vi.mocked(spend).mockImplementation(async () => {
        calls.push("spend");
        return true;
      });

      await POST(orderRequest("order-ordering"), { params });

      // The assertion this whole ticket is about.
      expect(calls).toEqual(["build", "spend"]);
    });

    test("a balance too small to cover the book draws no pages at all", async () => {
      vi.mocked(balanceOf).mockResolvedValue(CREDITS - 1);

      const response = await POST(orderRequest("order-no-credits"), { params });

      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toContain("state=no_credits");
      expect(buildPhotobook).not.toHaveBeenCalled();
      expect(spend).not.toHaveBeenCalled();
      expect(markFailed).toHaveBeenCalledWith(
        "alex",
        "order-no-credits",
        expect.any(Object),
        "no_credits",
      );
    });

    /**
     * B482. `preview/route.ts` already refuses to call a photograph-less book
     * `buyable`, but that is a courtesy the browser can be talked out of — a
     * stale tab that previewed while the trip still had photographs, then had
     * them all excluded or removed, could still post this form. Nothing here
     * cost anything (`spend`/`buildPhotobook`/`claimOrder` never run) and the
     * redirect says why, rather than silently paying ~90 credits for a padded
     * text-only book.
     */
    test("a book with no photographs charges nothing, even from a stale tab", async () => {
      vi.mocked(planFor).mockReturnValue({ ...BOOK, photoCount: 0 } as never);

      const response = await POST(orderRequest("order-no-photos"), { params });

      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toContain("state=no_photos");
      expect(claimOrder).not.toHaveBeenCalled();
      expect(buildPhotobook).not.toHaveBeenCalled();
      expect(spend).not.toHaveBeenCalled();
    });

    /**
     * B595. The preview and the press plan and price the same trip twice, and
     * between the two the trip on disk can change — a day published, a
     * photograph added. Paying whatever the second `priceOf` says, with no
     * check against what the first one told the owner, is how somebody is
     * charged a number their own screen never showed them. All three of the
     * ways this can fail answer the same `stale_preview`, and none of them
     * claims an order, builds a book or spends a credit.
     */
    describe("the previewed price must still hold at Pay time", () => {
      test("a price that grew between preview and press refuses rather than charging the new one", async () => {
        // `priceOf` now returns more than the form's `previewedCredits`
        // (still `CREDITS`, from the default) — a trip that grew a day or a
        // photograph in between.
        vi.mocked(priceOf).mockReturnValue(CREDITS + 12);

        const response = await POST(orderRequest("order-price-grew"), { params });

        expect(response.status).toBe(303);
        expect(response.headers.get("location")).toContain("state=stale_preview");
        expect(claimOrder).not.toHaveBeenCalled();
        expect(buildPhotobook).not.toHaveBeenCalled();
        expect(spend).not.toHaveBeenCalled();
      });

      test("a missing previewed price — an old tab, or a hand-built form — refuses the same way", async () => {
        const response = await POST(orderRequest("order-no-preview", ""), { params });

        expect(response.status).toBe(303);
        expect(response.headers.get("location")).toContain("state=stale_preview");
        expect(claimOrder).not.toHaveBeenCalled();
        expect(spend).not.toHaveBeenCalled();
      });

      test("a previewed price lower than the real one is refused too — it never lets a caller pay less by lying", async () => {
        const response = await POST(orderRequest("order-price-lied", String(CREDITS - 5)), {
          params,
        });

        expect(response.status).toBe(303);
        expect(response.headers.get("location")).toContain("state=stale_preview");
        expect(claimOrder).not.toHaveBeenCalled();
        expect(spend).not.toHaveBeenCalled();
      });

      test("a previewed price that still matches goes through exactly as before", async () => {
        vi.mocked(buildPhotobook).mockReturnValue({
          files: ["book-interior.pdf"],
          pages: 52,
          volumes: 1,
          missing: [],
        });
        vi.mocked(spend).mockResolvedValue(true);

        const response = await POST(orderRequest("order-price-matches"), { params });

        expect(response.status).toBe(303);
        expect(response.headers.get("location")).toContain("state=done");
        expect(spend).toHaveBeenCalledWith("alex", CREDITS, "photobook", "order-price-matches");
      });
    });

    test("a balance that moves under a finished book keeps the files and says so", async () => {
      // The narrow race the check above cannot close: two of the owner's own
      // sessions. The book exists, so it is kept — pressing Pay again after
      // topping up costs nothing extra, the id and the files being the same.
      vi.mocked(buildPhotobook).mockReturnValue({
        files: ["book-interior.pdf"],
        pages: 52,
        volumes: 1,
        missing: [],
      });
      vi.mocked(spend).mockResolvedValue(false);

      const response = await POST(orderRequest("order-raced"), { params });

      expect(response.headers.get("location")).toContain("state=no_credits");
      expect(buildPhotobook).toHaveBeenCalled();
      expect(markFailed).toHaveBeenCalledWith(
        "alex",
        "order-raced",
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
