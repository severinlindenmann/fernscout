import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { writeDayFixture, writeTripFixture } from "./fixtures/content";

/**
 * The close circle — B1749. A contact the owner moved into the close tier
 * reads what is marked `private` at all three levels (trip, day, photograph);
 * an ordinary guest reads none of it; demoting takes all three away at once.
 * One predicate (`isOpenToCloseCircle`, on `lib/photos.ts`' ladder) answers
 * for the three, so this test is the one that goes red if any gate drifts.
 */

const jar = vi.hoisted(() => ({ cookies: {} as Record<string, string> }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.cookies[name] === undefined ? undefined : { value: jar.cookies[name] }),
  }),
}));

const OWNER = "ana";
const OWNER_EMAIL = "ana@example.test";
const CLOSE = "mama@example.test";
const GUEST = "oma@example.test";

let dir: string;
const tokens: Record<string, string> = {};
const ids: Record<string, string> = {};

function as(viewer: string) {
  jar.cookies = { fs_session: tokens[viewer] };
}

async function signIn(email: string): Promise<string> {
  const { issueCode, verifyCode } = await import("@/lib/auth");
  const { code } = await issueCode(OWNER, email, "guest");
  const session = await verifyCode(OWNER, email, code, "guest");
  if (!session.ok) throw new Error(`sign-in failed for ${email}`);
  return session.token;
}

async function approve(email: string): Promise<string> {
  const { approveContact, confirmContactByOwner, listContacts, requestContact } = await import("@/lib/contacts");
  await requestContact(OWNER, {
    name: email,
    email,
    locale: "en",
    address: null,
    wantsEmailDigest: false,
    wantsPostcard: false,
    createdVia: "owner",
  });
  const contact = (await listContacts(OWNER)).find((c) => c.email === email)!;
  await confirmContactByOwner(OWNER, contact.id);
  await approveContact(OWNER, contact.id);
  return contact.id;
}

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xdb]);

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-close-circle-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "db.sqlite")}`;
  process.env.CONTACTS_ENCRYPTION_KEY = "44".repeat(32);
  process.env.SESSION_SECRET = "55".repeat(32);
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "R", url: "https://example.test", defaultUser: OWNER },
      users: { reserved: [] },
      features: { auth: { enabled: true }, contacts: { enabled: true } },
    }),
  );
  fs.mkdirSync(path.join(dir, OWNER), { recursive: true });
  fs.writeFileSync(
    path.join(dir, OWNER, "config.json"),
    JSON.stringify({
      title: "Two Backpacks",
      owner: { name: "Ana Meyer", nickname: "Ana", email: OWNER_EMAIL },
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
      features: { auth: { enabled: true }, contacts: { enabled: true } },
    }),
  );

  // A private trip, and a guest trip holding one private day and one private photograph.
  for (const [id, visibility] of [
    ["closed-2026", "private"],
    ["shared-2026", "guest"],
  ] as const) {
    writeTripFixture(OWNER, { id, title: id, start: "2026-08-25", end: "2026-08-26", status: "past", visibility });
  }
  fs.mkdirSync(path.join(dir, OWNER, "trips", "shared-2026", "media", "open"), { recursive: true });
  fs.mkdirSync(path.join(dir, OWNER, "trips", "shared-2026", "media", "hidden"), { recursive: true });
  fs.writeFileSync(path.join(dir, OWNER, "trips", "shared-2026", "media", "open", "01.jpg"), JPEG);
  fs.writeFileSync(path.join(dir, OWNER, "trips", "shared-2026", "media", "open", "02.jpg"), JPEG);
  writeDayFixture(dir, OWNER, "shared-2026", {
    slug: "open",
    date: "2026-08-25",
    title: "Open",
    media: [
      { src: "/media/shared-2026/open/01.jpg", type: "image" },
      { src: "/media/shared-2026/open/02.jpg", type: "image", visibility: "private" },
    ],
    content: "Open.",
  });
  writeDayFixture(dir, OWNER, "shared-2026", {
    slug: "hidden",
    date: "2026-08-26",
    title: "Hidden",
    visibility: "private",
    content: "Held back.",
  });

  ids.close = await approve(CLOSE);
  ids.guest = await approve(GUEST);
  tokens.close = await signIn(CLOSE);
  tokens.guest = await signIn(GUEST);
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

/** What one viewer reaches: the private trip, the private day, the private photograph. */
async function reach(viewer: string) {
  const { getDays } = await import("@/lib/entries");
  const { mayReadTrip, readFor } = await import("@/lib/tripGate");
  const { GET } = await import("@/app/at/[user]/media/[...path]/route");
  const { getTrips } = await import("@/lib/trips");
  as(viewer);
  const trips = new Map(getTrips(OWNER).map((t) => [t.id, t]));
  const shared = trips.get("shared-2026")!;
  const { read } = await readFor(shared);
  const days = getDays(shared.ref, read);
  const segments = ["shared-2026", "open", "02.jpg"];
  const photo = await GET(new Request(`https://example.test/@${OWNER}/media/${segments.join("/")}`), {
    params: Promise.resolve({ user: OWNER, path: segments }),
  } as never);
  return {
    trip: await mayReadTrip(trips.get("closed-2026")!),
    day: days.some((d) => d.date === "2026-08-26"),
    photo: photo.status === 200,
    gallery: days.find((d) => d.date === "2026-08-25")!.lead.gallery.length,
  };
}

describe("the close circle", () => {
  test("an ordinary guest is refused the private trip, day and photograph", async () => {
    expect(await reach("guest")).toEqual({ trip: false, day: false, photo: false, gallery: 1 });
  });

  test("promoting opens all three; demoting closes all three; promoting again reopens", async () => {
    const { setGrantScope } = await import("@/lib/grants");
    expect(await reach("close")).toMatchObject({ trip: false, day: false, photo: false });

    expect(await setGrantScope(OWNER, ids.close, "close")).toBe(true);
    expect(await reach("close")).toEqual({ trip: true, day: true, photo: true, gallery: 2 });
    // The ordinary guest is unmoved by somebody else's promotion.
    expect(await reach("guest")).toEqual({ trip: false, day: false, photo: false, gallery: 1 });

    expect(await setGrantScope(OWNER, ids.close, "read")).toBe(true);
    expect(await reach("close")).toEqual({ trip: false, day: false, photo: false, gallery: 1 });

    expect(await setGrantScope(OWNER, ids.close, "close")).toBe(true);
    expect(await reach("close")).toMatchObject({ trip: true, day: true, photo: true });
  });

  test("re-approving keeps the tier on one row, and a revoked contact returns as a reader", async () => {
    const { approveContact, revokeContact } = await import("@/lib/contacts");
    const { closeCircleContacts, grantScopeOf, setGrantScope } = await import("@/lib/grants");
    await approveContact(OWNER, ids.close);
    expect(await grantScopeOf(OWNER, ids.close)).toBe("close");

    await revokeContact(OWNER, ids.close);
    expect(await grantScopeOf(OWNER, ids.close)).toBeNull();
    // Promotion never creates access for somebody with no grant.
    expect(await setGrantScope(OWNER, ids.close, "close")).toBe(false);

    await approveContact(OWNER, ids.close);
    expect(await grantScopeOf(OWNER, ids.close)).toBe("read");
    expect((await closeCircleContacts(OWNER, new Date())).has(ids.close)).toBe(false);
  });
});
