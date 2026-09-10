import { describe, expect, test, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");

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
// B1157. One press buys a printed book, so the route quotes postage before it
// charges and hands the built book to the printer after. Both are mocked here:
// this file is about the money path, and the printer's own behaviour is
// test/photobook-print.test.ts.
vi.mock("@/lib/photobook/quote", () => ({ quoteBookFor: vi.fn() }));
vi.mock("@/lib/photobook/print", () => ({ submitBuiltBook: vi.fn() }));
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
import { quoteBookFor } from "@/lib/photobook/quote";
import { submitBuiltBook } from "@/lib/photobook/print";

const params = Promise.resolve({ user: "alex" });

/** A book just real enough for `pages`/`volumes` to sum without throwing —
 * the layout itself is `planFor`'s business, not this route's. */
const BOOK = { volumes: [{ interiorPages: 40 }], warnings: [], photoCount: 12 };
const BUILD_CREDITS = 40;
const PRINT_CREDITS = 48;
/** What the button says: building and printing are one purchase — B1157. */
const CREDITS = BUILD_CREDITS + PRINT_CREDITS;

function orderRequest(orderId: string, previewedCredits: string = String(CREDITS)) {
  return new Request("https://example.test/alex/photobook/order", {
    method: "POST",
    body: new URLSearchParams({
      trip: "alex/asia-2026",
      orderId,
      previewedCredits,
      // B1157: a book is bought printed and posted, so it needs somebody
      // to go to. `quoteBookFor` is mocked, so any id does here.
      contactId: "contact-1",
      options: JSON.stringify({
        size: "square",
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
      vi.mocked(priceOf).mockReturnValue(BUILD_CREDITS);
      // Build plus print: what the button says, and what is charged.
      vi.mocked(quoteBookFor).mockResolvedValue({
        buildCredits: BUILD_CREDITS,
        printCredits: PRINT_CREDITS,
        totalCredits: CREDITS,
        shipmentMethodUid: "swiss_post_economy",
        country: "CH",
      });
      vi.mocked(submitBuiltBook).mockResolvedValue({
        ok: true,
        providerRef: "gel-1",
        charged: CREDITS,
      });
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
      vi.mocked(buildPhotobook).mockImplementation(async () => {
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
      vi.mocked(buildPhotobook).mockImplementation(async () => {
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
        // The quote now totals more than the form's `previewedCredits` (still
        // `CREDITS`, from the default) — a trip that grew a day or a
        // photograph in between, or postage that moved. Since B1157 the total
        // is the quote's, not `priceOf`'s alone, so that is where the change
        // has to be made for this to be the case it describes.
        vi.mocked(quoteBookFor).mockResolvedValue({
          buildCredits: BUILD_CREDITS + 12,
          printCredits: PRINT_CREDITS,
          totalCredits: CREDITS + 12,
          shipmentMethodUid: "swiss_post_economy",
          country: "CH",
        });

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
        vi.mocked(buildPhotobook).mockResolvedValue({
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
      vi.mocked(buildPhotobook).mockResolvedValue({
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

  test("only the shapes of file this feature writes are served", async () => {
    const response = await GET(new Request("https://example.test/x"), {
      params: Promise.resolve({ user: "alex", id: "abc12345", file: "notes.txt" }),
    });
    expect(response.status).toBe(404);
  });

  test("the combined book is one of them — B1229", async () => {
    // Not 404 for the *name*: the build writes `book.pdf` (B1205) and the
    // receipt links to it, and this route used to refuse the only file a
    // person actually uploads to a printer. It still 404s here because no
    // such order exists on disk — what is being asserted is that the refusal
    // is about the missing file and not about the filename.
    const named = await GET(new Request("https://example.test/x"), {
      params: Promise.resolve({ user: "alex", id: "abc12345", file: "book.pdf" }),
    });
    const rejected = await GET(new Request("https://example.test/x"), {
      params: Promise.resolve({ user: "alex", id: "abc12345", file: "book.txt" }),
    });
    expect(named.status).toBe(404);
    expect(rejected.status).toBe(404);
    // Both 404, so prove the pattern itself rather than the response.
    const source = fs.readFileSync(
      path.join(ROOT, "app", "[user]", "photobooks", "[id]", "[file]", "route.ts"),
      "utf8",
    );
    const pattern = source.match(/const FILE_RE = (\/.*\/);/)?.[1];
    expect(pattern).toBeTruthy();
    const re = new RegExp(pattern!.slice(1, -1));
    expect(re.test("book.pdf")).toBe(true);
    expect(re.test("v2.pdf")).toBe(true);
    expect(re.test("book-interior.pdf")).toBe(true);
    expect(re.test("book-cover.pdf")).toBe(true);
    expect(re.test("book.txt")).toBe(false);
    expect(re.test("../book.pdf")).toBe(false);
  });
});
