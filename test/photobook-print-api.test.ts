import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { balanceOf, grant } from "@/lib/credits";
import { issueCode, verifyCode, tripWriteScope } from "@/lib/auth";
import { approveContact, confirmContact, requestContact } from "@/lib/contacts";
import { DEFAULT_OPTIONS } from "@/lib/photobook/options";
import { claimOrder, markPrinted, type PhotobookPayload } from "@/lib/photobook/orders";

// No cookie ever arrives on any of these calls — every credential here is a
// bearer token. `next/headers` mocked to an empty jar so `resolveAccess`
// runs for real and simply has nothing to read, the same shape
// `test/helper-routes-bearer-refused.test.ts` uses.
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));

vi.mock("@/lib/photobook/gelato", async () => {
  const actual = await vi.importActual<typeof import("@/lib/photobook/gelato")>("@/lib/photobook/gelato");
  return {
    ...actual,
    quoteBook: vi.fn(),
    submitBookPrint: vi.fn(),
  };
});

import { quoteBook, submitBookPrint } from "@/lib/photobook/gelato";
import { POST as printPOST } from "@/app/api/v1/[user]/photobooks/[id]/print/route";
import { GET as orderGET } from "@/app/api/v1/[user]/photobooks/[id]/route";

/**
 * Task 6 — the agent's proposal, and never the press.
 *
 * The same shape `test/postcard-orders.test.ts` (well, its API-route sibling)
 * holds `POST .../postcards` to: writes a proposal and answers with a URL,
 * charges nothing, refuses an unknown recipient and a trip-scoped token, and
 * reads back through the matching `GET` — with no street address anywhere in
 * either answer.
 */

const OWNER = "ana";
const OWNER_EMAIL = "ana@example.test";
const BUDDY_EMAIL = "buddy@example.test";
const ID = "book-one-12345";
const TRIP = "alps-2026";

const ADDRESS = {
  name: "A Reader",
  line1: "Bahnhofstrasse 1",
  line2: "",
  postcode: "8001",
  city: "Zurich",
  country: "Switzerland",
  tel: "+41 00 000 00 00",
};
const CONTACT_STREET = "Bahnhofstrasse 1";

const PAYLOAD: PhotobookPayload = {
  trip: `${OWNER}/${TRIP}`,
  options: DEFAULT_OPTIONS,
  pages: 52,
  volumes: 1,
  credits: 194,
  files: ["book-interior.pdf", "book-cover.pdf"],
};

const QUOTE_RESULT = {
  printMinor: 1440,
  shipMinor: 220,
  currency: "CHF",
  shipmentMethodUid: "swiss_post_economy",
  expiresAt: "2026-09-08T00:00:00+00:00",
};

let dir: string;
let CONTACT: string;

async function activeContact(email: string) {
  const { contactId } = await requestContact(OWNER, {
    name: "A Reader",
    email,
    locale: "en",
    address: ADDRESS,
    wantsEmailDigest: false,
    wantsPostcard: false,
    createdVia: "owner",
  });
  const { code } = await issueCode(OWNER, email, "guest");
  const confirmed = await confirmContact(OWNER, email, code);
  if (!confirmed.ok) throw new Error(`confirm failed for ${email}`);
  const approved = await approveContact(OWNER, contactId!);
  if (!approved || approved.contact.status !== "active") throw new Error(`approve failed for ${email}`);
  return contactId!;
}

async function ownerToken(): Promise<string> {
  const { code } = await issueCode(OWNER, OWNER_EMAIL, "agent");
  const session = await verifyCode(OWNER, OWNER_EMAIL, code, "agent");
  if (!session.ok) throw new Error(`could not mint an owner token: ${session.reason}`);
  return session.token;
}

async function tripScopedToken(): Promise<string> {
  const { code } = await issueCode(OWNER, BUDDY_EMAIL, "agent", { trip: TRIP });
  const session = await verifyCode(OWNER, BUDDY_EMAIL, code, "agent", tripWriteScope(TRIP));
  if (!session.ok) throw new Error(`could not mint a trip token: ${session.reason}`);
  return session.token;
}

function request(body?: unknown, token?: string): Request {
  return new Request(`https://example.test/api/v1/${OWNER}/photobooks/${ID}/print`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

function ctx() {
  return { params: Promise.resolve({ user: OWNER, id: ID }) };
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-photobook-print-api-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "orders.db")}`;
  process.env.CONTACTS_ENCRYPTION_KEY = "22".repeat(32);
  process.env.GELATO_API_KEY = "test-key";
  process.env.SESSION_SECRET = "photobook-print-api-test-secret-photobook";
  delete process.env.AUTH_DEV_CODE;

  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "R", url: "https://example.test" },
      users: { reserved: [] },
      features: {
        credits: { enabled: true },
        photobook: { enabled: true, provider: "gelato" },
      },
    }),
  );
  fs.mkdirSync(path.join(dir, OWNER, "trips", TRIP, "entries"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, OWNER, "config.json"),
    JSON.stringify({
      title: OWNER,
      owner: { name: OWNER, nickname: OWNER, email: OWNER_EMAIL },
      features: { photobook: { enabled: true } },
    }),
  );
  fs.writeFileSync(
    path.join(dir, OWNER, "trips", TRIP, "trip.md"),
    "---\ntitle: Alps\nstartDate: 2026-01-01\nendDate: 2026-01-05\npeople:\n  - name: Buddy\n    email: buddy@example.test\n---\n",
  );

  clearConfigCache();
  clearUserCache();
  const { migrateToLatest } = await import("@/lib/db/migrate");
  await migrateToLatest(await getDatabase());

  await grant(OWNER, 500);
  CONTACT = await activeContact("reader@example.test");

  await claimOrder(OWNER, ID, PAYLOAD);
  await markPrinted(OWNER, ID, PAYLOAD);

  vi.mocked(quoteBook).mockResolvedValue(QUOTE_RESULT);
  vi.mocked(submitBookPrint).mockResolvedValue({ providerRef: "gel-1" });
});

afterEach(async () => {
  await closeDatabase();
  delete process.env.CONTENT_DIR;
  delete process.env.DATABASE_URL;
  delete process.env.CONTACTS_ENCRYPTION_KEY;
  delete process.env.GELATO_API_KEY;
  delete process.env.SESSION_SECRET;
  clearConfigCache();
  clearUserCache();
  fs.rmSync(dir, { recursive: true, force: true });
  vi.clearAllMocks();
});

describe("POST .../photobooks/:id/print", () => {
  test("writes a proposal and charges nothing", async () => {
    const token = await ownerToken();
    const before = await balanceOf(OWNER);
    const res = await printPOST(request({ contactId: CONTACT }, token), ctx());
    expect(res.status).toBe(201);
    expect(await balanceOf(OWNER)).toBe(before);
    expect(submitBookPrint).not.toHaveBeenCalled();
  });

  test("answers with a URL a person opens, not a confirmation", async () => {
    const token = await ownerToken();
    const body = (await (await printPOST(request({ contactId: CONTACT }, token), ctx())).json()) as {
      url: string;
    };
    expect(body.url).toContain(`/${OWNER}/photobooks/${ID}`);
  });

  test("refuses a contact this journal does not have", async () => {
    const token = await ownerToken();
    const res = await printPOST(request({ contactId: "not-a-contact" }, token), ctx());
    expect(res.status).toBe(400);
  });

  test("refuses a trip-scoped token", async () => {
    const token = await tripScopedToken();
    const res = await printPOST(request({ contactId: CONTACT }, token), ctx());
    expect(res.status).toBe(403);
  });

  test("refuses with no credential at all", async () => {
    const res = await printPOST(request({ contactId: CONTACT }), ctx());
    expect(res.status).toBe(403);
  });

  test("reads the proposal back, so an agent can check its own work", async () => {
    const token = await ownerToken();
    await printPOST(request({ contactId: CONTACT }, token), ctx());
    const body = (await (await orderGET(request(undefined, token), ctx())).json()) as {
      print?: { contactId?: string };
    };
    expect(body.print).toMatchObject({ contactId: CONTACT });
  });

  test("never returns an address", async () => {
    const token = await ownerToken();
    await printPOST(request({ contactId: CONTACT }, token), ctx());
    const body = await (await orderGET(request(undefined, token), ctx())).json();
    expect(JSON.stringify(body)).not.toContain(CONTACT_STREET);
  });
});

describe("the outcome table on the order page", () => {
  test("covers every PrintFailure plus 'printed' and 'forbidden'", async () => {
    const { PHOTOBOOK_PRINT_OUTCOME_STATES } = await import("@/lib/photobook/print");
    // A PrintFailure imported only for its type would be erased at build time
    // and could not be checked at runtime; the states list is the runtime
    // source of truth this asserts against instead.
    expect(PHOTOBOOK_PRINT_OUTCOME_STATES).toEqual(
      expect.arrayContaining([
        "printed",
        "forbidden",
        "unknown_order",
        "not_built",
        "already_printing",
        "no_recipient",
        "no_credits",
        "stale_quote",
        "unknown_country",
        "provider_unavailable",
        "refused",
      ]),
    );
  });
});
