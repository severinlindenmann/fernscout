/**
 * Print-on-demand providers, prepared but not connected.
 *
 * Same shape and same discipline as `lib/postcard/providers.ts`: every function
 * here builds a request and stops. Nothing is called, because calling anything
 * needs an account, and the account is the boundary this work package was told
 * to stop at.
 *
 * What that buys is not nothing. The payload shapes, the auth models, the file
 * requirements and — the one that actually shapes the deployment — *how each
 * provider gets hold of the PDF* are settled and tested against fixtures now.
 * Three of these four do not accept an upload at all: they fetch the file from
 * a URL you give them, which means a self-hosted book needs a reachable,
 * unguessable link before a single order can be placed. That is an
 * infrastructure decision, and it is much better made now than on the evening
 * you want to order a Christmas present.
 *
 * **Every field name below is written from published documentation and has not
 * been confirmed against a live account.** docs/providers/photobook.md says so
 * too, and lists what to verify first.
 */

export type ProviderName = "dry-run" | "peecho" | "gelato" | "cloudprinter" | "lulu";

/** How a provider gets the PDF. This is the difference that matters most. */
export type FileTransfer = "fetches-from-url" | "multipart-upload";

export type ShippingAddress = {
  name: string;
  line1: string;
  line2?: string;
  postcode: string;
  city: string;
  /** ISO 3166-1 alpha-2. */
  country: string;
  email: string;
  phone?: string;
};

export type BookOrder = {
  /** Your own reference. Every provider echoes it back on the webhook. */
  reference: string;
  title: string;
  /** Interior PDF, one page per book page. */
  interiorUrl: string;
  /** Cover PDF: back, spine and front on one wide page. */
  coverUrl: string;
  interiorMd5?: string;
  coverMd5?: string;
  pageCount: number;
  trimWidthMm: number;
  trimHeightMm: number;
  copies: number;
  to: ShippingAddress;
  /** True until you actually want paper to move. */
  test: boolean;
};

export type PreparedRequest = {
  provider: ProviderName;
  method: "POST";
  url: string;
  /** Header names only — never the values, which are secrets. */
  authHeaders: string[];
  transfer: FileTransfer;
  /** The request body, with secrets replaced by the name of the variable that
   * would hold them. Safe to write to disk and to commit as a fixture. */
  body: unknown;
  /** What must be true before this can succeed. */
  requires: string[];
};

// ---------------------------------------------------------------------------
// Peecho (acquired by Prodigi, 2024)
// ---------------------------------------------------------------------------

/**
 * Peecho — the one built for exactly this.
 *
 * Peecho's whole product is "someone made a PDF, now sell it as a printed
 * book", which is this project's shape precisely. Its European fulfilment is
 * good and it will print a one-off. Since the Prodigi acquisition the strategic
 * question is which API survives; the Prodigi Print API (v4, `X-API-Key`,
 * `https://api.prodigi.com/v4.0/Orders`) is the better-documented of the two
 * and should be checked first.
 */
export function buildPeechoRequest(order: BookOrder): PreparedRequest {
  return {
    provider: "peecho",
    method: "POST",
    url: "https://www.peecho.com/rest/v2/orders",
    authHeaders: ["X-API-Key"],
    transfer: "fetches-from-url",
    body: {
      merchantReference: order.reference,
      test: order.test,
      items: [
        {
          offeringId: "PEECHO_OFFERING_ID",
          quantity: order.copies,
          title: order.title,
          numberOfPages: order.pageCount,
          contentUrl: order.interiorUrl,
          coverUrl: order.coverUrl,
        },
      ],
      address: {
        name: order.to.name,
        address: order.to.line1,
        address2: order.to.line2,
        postalCode: order.to.postcode,
        city: order.to.city,
        countryCode: order.to.country,
        email: order.to.email,
      },
    },
    requires: [
      "PEECHO_API_KEY",
      "A Peecho (or Prodigi) account with a configured offering for this trim size and page range",
      "The interior and cover PDFs reachable at a public HTTPS URL",
      "Field names confirmed against the current Peecho/Prodigi API documentation",
    ],
  };
}

// ---------------------------------------------------------------------------
// Gelato
// ---------------------------------------------------------------------------

/**
 * Gelato — the widest network, and the one most likely to print in Switzerland.
 *
 * Gelato routes to whichever partner is nearest the address, which for a Swiss
 * or European recipient usually means no customs and two or three days. Its
 * catalogue is addressed by long product UIDs; the one below has the right
 * *shape* but must be taken from Gelato's live product API rather than typed
 * from memory.
 */
export function buildGelatoRequest(order: BookOrder): PreparedRequest {
  const uid =
    `photobook_pf_${order.trimWidthMm}x${order.trimHeightMm}-mm_` +
    `pt_${order.pageCount}-pages_cl_4-4_ct_matt-lamination_ver_softcover`;
  return {
    provider: "gelato",
    method: "POST",
    url: "https://order.gelatoapis.com/v4/orders",
    authHeaders: ["X-API-KEY"],
    transfer: "fetches-from-url",
    body: {
      orderType: order.test ? "draft" : "order",
      orderReferenceId: order.reference,
      customerReferenceId: order.reference,
      currency: "CHF",
      items: [
        {
          itemReferenceId: `${order.reference}-book`,
          productUid: uid,
          pageCount: order.pageCount,
          quantity: order.copies,
          files: [
            { type: "cover", url: order.coverUrl },
            { type: "default", url: order.interiorUrl },
          ],
        },
      ],
      shipmentMethodUid: "normal",
      shippingAddress: {
        firstName: order.to.name.split(" ").slice(0, -1).join(" ") || order.to.name,
        lastName: order.to.name.split(" ").slice(-1).join(" "),
        addressLine1: order.to.line1,
        addressLine2: order.to.line2,
        city: order.to.city,
        postCode: order.to.postcode,
        country: order.to.country,
        email: order.to.email,
        phone: order.to.phone,
      },
    },
    requires: [
      "GELATO_API_KEY",
      "The real productUid from GET https://product.gelatoapis.com/v3/... — the one above is the right shape, not a real id",
      "The interior and cover PDFs reachable at a public HTTPS URL",
      "orderType 'draft' first: Gelato validates the files without printing",
    ],
  };
}

// ---------------------------------------------------------------------------
// Cloudprinter
// ---------------------------------------------------------------------------

/**
 * Cloudprinter — a broker rather than a printer.
 *
 * It sits in front of a network of European printing partners and picks one.
 * Two consequences worth knowing before choosing it: the page-count and paper
 * options are per partner rather than global, so the quote endpoint is the only
 * honest source of what is possible; and the API key travels **in the request
 * body**, not in a header, which changes how it must be kept out of logs.
 */
export function buildCloudprinterRequest(order: BookOrder): PreparedRequest {
  return {
    provider: "cloudprinter",
    method: "POST",
    url: "https://api.cloudprinter.com/cloudcore/1.0/orders/add",
    authHeaders: [],
    transfer: "fetches-from-url",
    body: {
      // Sent in the body, which is why authHeaders is empty. Never log this.
      apikey: "$CLOUDPRINTER_API_KEY",
      reference: order.reference,
      email: order.to.email,
      addresses: [
        {
          type: "delivery",
          firstname: order.to.name.split(" ").slice(0, -1).join(" ") || order.to.name,
          lastname: order.to.name.split(" ").slice(-1).join(" "),
          street1: order.to.line1,
          street2: order.to.line2,
          zip: order.to.postcode,
          city: order.to.city,
          country: order.to.country,
          email: order.to.email,
        },
      ],
      items: [
        {
          reference: `${order.reference}-book`,
          product: "book_softcover_perfect_bound",
          shipping_level: "cp_saver",
          title: order.title,
          count: order.copies,
          files: [
            { type: "cover", url: order.coverUrl, md5sum: order.coverMd5 ?? "" },
            { type: "book", url: order.interiorUrl, md5sum: order.interiorMd5 ?? "" },
          ],
          options: [
            { type: "total_pages", count: order.pageCount },
            { type: "pageblock_80mc" },
            { type: "cover_matt_lamination" },
          ],
        },
      ],
    },
    requires: [
      "CLOUDPRINTER_API_KEY",
      "An MD5 of each PDF — Cloudprinter verifies what it downloaded against it",
      "The product code and option codes from POST /cloudcore/1.0/products, which vary by partner",
      "A quote from /orders/quote first: it returns the real page-count range for the chosen partner",
    ],
  };
}

// ---------------------------------------------------------------------------
// Lulu
// ---------------------------------------------------------------------------

/**
 * Lulu — the only one of the four with a free sandbox.
 *
 * That single fact makes it the right place to start. `api.sandbox.lulu.com`
 * takes a real print job, runs the same file validation as production, and
 * prints nothing. It is the only way to answer "does my PDF pass preflight?"
 * without paying for a book, and it answers it before an account with a card on
 * it is needed.
 *
 * Authentication is OAuth2 client credentials rather than a static key, so
 * there is a token exchange before every session — the one place where these
 * four differ structurally.
 */
export function buildLuluRequest(order: BookOrder): PreparedRequest {
  return {
    provider: "lulu",
    method: "POST",
    url: order.test
      ? "https://api.sandbox.lulu.com/print-jobs/"
      : "https://api.lulu.com/print-jobs/",
    authHeaders: ["Authorization"],
    transfer: "fetches-from-url",
    body: {
      external_id: order.reference,
      contact_email: order.to.email,
      line_items: [
        {
          title: order.title,
          // 27-character pod_package_id: trim size, colour, binding, paper,
          // finish, lining and spine. Must be copied from Lulu's spec sheet.
          pod_package_id: "LULU_POD_PACKAGE_ID",
          page_count: order.pageCount,
          quantity: order.copies,
          cover_source_url: order.coverUrl,
          interior_source_url: order.interiorUrl,
        },
      ],
      shipping_address: {
        name: order.to.name,
        street1: order.to.line1,
        street2: order.to.line2,
        city: order.to.city,
        postcode: order.to.postcode,
        country_code: order.to.country,
        phone_number: order.to.phone,
      },
      shipping_level: "MAIL",
    },
    requires: [
      "LULU_CLIENT_KEY and LULU_CLIENT_SECRET",
      "An OAuth2 token from POST /auth/realms/glasstree/protocol/openid-connect/token",
      "The pod_package_id for the chosen trim, binding and paper from Lulu's specification sheet",
      "The interior and cover PDFs reachable at a public HTTPS URL",
    ],
  };
}

export function buildRequest(provider: ProviderName, order: BookOrder): PreparedRequest {
  switch (provider) {
    case "peecho":
      return buildPeechoRequest(order);
    case "gelato":
      return buildGelatoRequest(order);
    case "cloudprinter":
      return buildCloudprinterRequest(order);
    case "lulu":
      return buildLuluRequest(order);
    case "dry-run":
      throw new Error("The dry-run backend writes files; it has no request to build.");
  }
}

export const CONNECTABLE: readonly ProviderName[] = ["peecho", "gelato", "cloudprinter", "lulu"];

/** What can be used today, with no account, for development. */
export function availableProviders(): Record<ProviderName, { ready: boolean; note: string }> {
  return {
    "dry-run": {
      ready: true,
      note: "Writes print-ready PDFs to ./out/photobooks. No account, no network.",
    },
    peecho: {
      ready: false,
      note: "Request builder written and tested. Needs PEECHO_API_KEY, a configured offering, and public file URLs.",
    },
    gelato: {
      ready: false,
      note: "Request builder written and tested. Needs GELATO_API_KEY and a real productUid from the product API.",
    },
    cloudprinter: {
      ready: false,
      note: "Request builder written and tested. Needs CLOUDPRINTER_API_KEY, per-partner product codes and file MD5s.",
    },
    lulu: {
      ready: false,
      note: "Request builder written and tested. Has a free sandbox — start here. Needs LULU_CLIENT_KEY/SECRET.",
    },
  };
}
