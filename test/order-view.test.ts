import { describe, expect, it } from "vitest";
import { photobookOrderView, postcardOrderView, addressLines } from "@/lib/order/view";
import type { PhotobookOrder, PhotobookPayload } from "@/lib/photobook/orders";
import type { PostcardOrder } from "@/lib/postcard/orders";
import { translateIn } from "@/lib/locales";
import type { TranslationKey } from "@/lib/i18n";

/**
 * The view model, in the states a reader cannot reach — B1463.
 *
 * This is the whole reason the adapters are pure and synchronous: a refused
 * print, an unmapped printer word and an expired proposal are all states that
 * take a provider, a week or a failure to produce in a browser, and every one
 * of them is one object literal here.
 */

const t = (key: TranslationKey, vars?: Record<string, string>) => translateIn("en", key, vars);

function book(payload: Partial<PhotobookPayload> = {}): PhotobookOrder {
  return {
    id: "9f1b3820-2e6f-4f57-b9ed-1e216c44099b",
    owner: "example",
    status: "built",
    createdAt: "2026-09-11T09:12:00Z",
    updatedAt: "2026-09-11T09:12:00Z",
    payload: {
      trip: "example/algarve-2026",
      options: { size: "square", coverType: "soft" } as PhotobookPayload["options"],
      pages: 46,
      volumes: 1,
      credits: 238,
      files: ["book.pdf"],
      ...payload,
    },
  };
}

const bookInput = {
  t,
  tripTitle: "Algarve 2026",
  sizeLabel: "Square 200 × 200 mm",
  recipient: {
    name: "A Reader",
    line1: "Street 1", line2: "", postcode: "1234", city: "Town", country: "CH",
  },
  files: ["book.pdf"],
  fileHref: (file: string) => `/example/photobooks/x/${file}`,
};

function cards(payload: Partial<PostcardOrder["payload"]> = {}, over: Partial<PostcardOrder> = {}): PostcardOrder {
  return {
    id: "7c41e0b9",
    owner: "example",
    status: "draft",
    provider: "dry-run",
    createdAt: "2026-09-10T08:00:00Z",
    updatedAt: "2026-09-10T08:00:00Z",
    payload: {
      trip: "example/algarve-2026",
      day: "2026-08-14-lagos",
      photo: "a.jpg",
      message: "Hello",
      from: "Us",
      recipients: ["c1", "c2", "c3", "c4"],
      locale: "de",
      creditsEach: 20,
      expiresAt: "2026-09-17T08:00:00Z",
      ...payload,
    },
    ...over,
  };
}

const cardInput = {
  t,
  dayName: "A morning in Lagos",
  sentWhen: "10 September",
  recipients: [
    { name: "One", town: "Bern, CH" },
    { name: "Two", town: "Wien, AT" },
    { name: "Three", town: "Luzern, CH" },
    { name: "Four", town: "Lisboa, PT" },
  ],
  // Fixed so the expiry branch is a decision rather than a date the suite
  // crosses one week after it was written.
  now: Date.parse("2026-09-12T00:00:00Z"),
};

describe("addressLines", () => {
  it("drops an empty line rather than leaving a gap in the envelope", () => {
    expect(
      addressLines({
        name: "A Reader", line1: "Street 1", line2: "",
        postcode: "1234", city: "Town", country: "CH",
      }),
    ).toEqual(["Street 1", "1234 Town", "CH"]);
  });
});

describe("photobookOrderView", () => {
  it("charges once and totals to what was paid", () => {
    const view = photobookOrderView({
      ...bookInput,
      order: book({ print: { contactId: "c1", quotedCredits: 238, quotedAt: "", shipmentMethodUid: "x", providerRef: "g1" } }),
      providerStatus: "created",
    });
    expect(view.ledger.lines).toHaveLength(1);
    expect(view.ledger.totalCredits).toBe(238);
    expect(view.ledger.totalMoney).toContain("CHF 47.60");
    expect(view.status).toMatchObject({ tone: "navy", label: "Waiting to be printed" });
    expect(view.files[0].href).toBe("/example/photobooks/x/book.pdf");
  });

  it("maps in_production to the yellow tone and its own sentence", () => {
    const view = photobookOrderView({
      ...bookInput,
      order: book({ print: { contactId: "c1", quotedCredits: 238, quotedAt: "", shipmentMethodUid: "x", providerRef: "g1" } }),
      providerStatus: "in_production",
    });
    expect(view.status).toMatchObject({ tone: "yellow", label: "Being printed" });
    expect(view.status?.note).toBe("It is being made now.");
  });

  it("never gives an unmapped provider word a colour or a translation", () => {
    const view = photobookOrderView({
      ...bookInput,
      order: book({ print: { contactId: "c1", quotedCredits: 238, quotedAt: "", shipmentMethodUid: "x", providerRef: "g1" } }),
      providerStatus: "held_at_customs",
    });
    expect(view.status).toEqual({ tone: "navy", label: "held_at_customs" });
  });

  it("refunds to zero even when the printer had already given an order id", () => {
    // The shape B1454 found: Gelato accepts, hands back a ref, and only then
    // refuses. Whether the credits are back is a fact about `failure`, never
    // about which branch drew the pill.
    const view = photobookOrderView({
      ...bookInput,
      order: book({
        print: {
          contactId: "c1", quotedCredits: 238, quotedAt: "", shipmentMethodUid: "x",
          providerRef: "g1", failure: "refused",
        },
      }),
      providerStatus: "failed",
    });
    expect(view.status?.tone).toBe("coral");
    expect(view.ledger.lines[1]).toMatchObject({ refund: true, credits: 238 });
    expect(view.ledger.totalCredits).toBe(0);
    expect(view.status?.note).toContain("238 credits are back");
  });

  it("says the lookup failed rather than inventing a state", () => {
    const view = photobookOrderView({
      ...bookInput,
      order: book({ print: { contactId: "c1", quotedCredits: 238, quotedAt: "", shipmentMethodUid: "x", providerRef: "g1" } }),
      providerStatus: null,
    });
    expect(view.status).toEqual({ tone: "navy", label: "Unknown" });
  });

  it("explains a book from before a print door existed", () => {
    const view = photobookOrderView({ ...bookInput, order: book() });
    expect(view.status?.note).toContain("before this journal could buy a printed copy");
    expect(view.ledger.totalCredits).toBe(238);
  });

  it("drops the envelope rather than throwing when the contact is gone", () => {
    const view = photobookOrderView({ ...bookInput, recipient: null, order: book() });
    expect(view.recipients).toEqual([]);
  });
});

describe("postcardOrderView", () => {
  it("prices four cards as four and waits for the owner", () => {
    const view = postcardOrderView({ ...cardInput, order: cards() });
    expect(view.ledger.lines[0].label).toBe("20 credits each × 4");
    expect(view.ledger.totalCredits).toBe(80);
    expect(view.ledger.totalMoney).toContain("CHF 16.00");
    expect(view.status).toMatchObject({ tone: "navy", label: "Waiting for you" });
    expect(view.head.title).toBe("Postcards, ready to send");
    expect(view.recipients).toHaveLength(4);
  });

  it("keeps a street out of the envelope it hands over", () => {
    const view = postcardOrderView({ ...cardInput, order: cards() });
    expect(view.recipients[0].lines).toEqual(["Bern, CH"]);
  });

  it("reads as sent once it is no longer pending", () => {
    const view = postcardOrderView({ ...cardInput, order: cards({}, { status: "built" }) });
    expect(view.status?.tone).toBe("green");
    expect(view.head.title).toBe("Postcards, sent");
    expect(view.head.subtitle).toContain("10 September");
    expect(view.meta).toContain("Sent");
  });

  it("refunds a refused set the way a refused book is refunded", () => {
    const view = postcardOrderView({ ...cardInput, order: cards({}, { status: "failed" }) });
    expect(view.status?.tone).toBe("coral");
    expect(view.ledger.totalCredits).toBe(0);
    expect(view.head.title).toBe("Postcards, not sent");
  });

  it("says expired rather than waiting for somebody who can no longer act", () => {
    const view = postcardOrderView({
      ...cardInput,
      order: cards({ expiresAt: "2026-09-11T00:00:00Z" }),
    });
    expect(view.status?.label).toBe("Expired");
  });

  it("names no day for a card staged from the inbox", () => {
    const view = postcardOrderView({
      ...cardInput,
      dayName: null,
      order: cards({ trip: null, day: null }),
    });
    expect(view.head.subtitle).toContain("a photograph you staged");
  });
});
