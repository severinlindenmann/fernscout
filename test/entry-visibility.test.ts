import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import type { Trip } from "@/lib/types";

/**
 * B632 — a whole update held back from readers a trip otherwise lets in.
 *
 * Built as the direct sibling of `test/photo-visibility.test.ts`: same
 * vocabulary (`lib/photos.ts`), same narrowing rule, same fixture shape — one
 * trip per trip-level visibility, three entries per day carrying no label, a
 * `guest` label and a `private` label. Where that file asks "how many of the
 * three photographs does this viewer see", this asks "how many of the three
 * *entries* does this viewer see", and then goes on to the surfaces a
 * photograph does not have of its own: the feed, the sitemap, the search
 * index and the markdown twin — every one of them built by walking every
 * entry rather than answering one page's own request, so a filter missed in
 * any of them is a leak wearing a different hat.
 */

const jar = vi.hoisted(() => ({ cookies: {} as Record<string, string> }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      jar.cookies[name] === undefined ? undefined : { value: jar.cookies[name] },
  }),
}));

const OWNER = "mira";
const OWNER_EMAIL = "mira@example.test";
const GUEST = "friend@example.test";
const ROBIN = "robin@example.test";
const STRANGER = "anyone@example.test";

/** The three updates every day in this fixture carries, on one date. */
const ENTRIES = [
  { slug: "arrival", label: null as null | "guest" | "private" },
  { slug: "arrival-guest-note", label: "guest" as const },
  { slug: "arrival-private-note", label: "private" as const },
];

const TRIPS = [
  { id: "open-2026", visibility: "public" },
  { id: "invited-2026", visibility: "guest" },
  { id: "closed-2026", visibility: "private" },
];

/** How many of the three entries each viewer sees on each trip. `null` means
 * the trip's own gate refuses them outright. */
const EXPECTED: Record<string, Record<string, number | null>> = {
  anonymous: { "open-2026": 1, "invited-2026": null, "closed-2026": null },
  stranger: { "open-2026": 1, "invited-2026": null, "closed-2026": null },
  guest: { "open-2026": 2, "invited-2026": 2, "closed-2026": null },
  traveller: { "open-2026": 3, "invited-2026": 3, "closed-2026": 3 },
  owner: { "open-2026": 3, "invited-2026": 3, "closed-2026": 3 },
};

let dir: string;
const tokens: Record<string, string | null> = { anonymous: null };

function writeConfigs() {
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
      title: "Mira's Journal",
      owner: { name: "Mira K", nickname: "Mira", email: OWNER_EMAIL },
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
      features: { auth: { enabled: true }, contacts: { enabled: true } },
    }),
  );
}

function writeTrip(spec: (typeof TRIPS)[number]) {
  const root = path.join(dir, OWNER, "trips", spec.id);
  fs.mkdirSync(path.join(root, "entries"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "trip.md"),
    [
      "---",
      `id: "${spec.id}"`,
      `title: "${spec.id}"`,
      'start: "2026-08-25"',
      'end: "2026-08-26"',
      'status: "past"',
      `visibility: "${spec.visibility}"`,
      "people:",
      `  - { name: "Robin", email: "${ROBIN}" }`,
      "---",
      "",
      "Intro.",
      "",
    ].join("\n"),
  );

  for (const [i, entry] of ENTRIES.entries()) {
    // One photograph per update, carrying **no label of its own** — which is
    // the whole point: what holds it back can only be the update it belongs
    // to. A second file beside it is never mentioned in the gallery, standing
    // in for an original or anything else ingest leaves in the folder.
    fs.mkdirSync(path.join(root, "media", entry.slug), { recursive: true });
    for (const file of ["01.jpg", "loose.jpg"]) {
      // A JPEG's first four bytes, which is all `contentTypeFor` looks at.
      fs.writeFileSync(
        path.join(root, "media", entry.slug, file),
        Buffer.from([0xff, 0xd8, 0xff, 0xdb]),
      );
    }

    fs.writeFileSync(
      path.join(root, "entries", `2026-08-25-${entry.slug}.md`),
      [
        "---",
        `title: "${entry.slug}"`,
        'date: "2026-08-25"',
        `time: "${String(9 + i).padStart(2, "0")}:00"`,
        'location: "Bellinzona"',
        'country: "Switzerland"',
        ...(entry.label ? [`visibility: "${entry.label}"`] : []),
        "gallery:",
        `  - src: "/media/${spec.id}/${entry.slug}/01.jpg"`,
        '    type: "image"',
        "tags: [\"day\"]",
        "---",
        "",
        `Update ${i}.`,
        "",
      ].join("\n"),
    );
  }
}

async function signIn(email: string): Promise<string> {
  const { issueCode, verifyCode } = await import("@/lib/auth");
  const { code } = await issueCode(OWNER, email, "guest");
  const session = await verifyCode(OWNER, email, code, "guest");
  if (!session.ok) throw new Error(`sign-in failed for ${email}: ${session.reason}`);
  return session.token;
}

async function addApprovedContact(email: string) {
  const { approveContact, confirmContact, listContacts, requestContact } = await import(
    "@/lib/contacts"
  );
  const { issueCode } = await import("@/lib/auth");
  await requestContact(OWNER, {
    name: "Reader",
    email,
    locale: "en",
    address: null,
    // true, unlike most fixtures that name this contact — this one is reused
    // below to prove a held-back day mails fewer recipients than an
    // ordinary one, which needs the digest opt-in actually on.
    wantsEmailDigest: true,
    wantsPostcard: false,
    createdVia: "owner",
  });
  const { code } = await issueCode(OWNER, email, "guest");
  const confirmed = await confirmContact(OWNER, email, code);
  if (!confirmed.ok) throw new Error(`confirm failed for ${email}`);
  const contact = (await listContacts(OWNER)).find((c) => c.email === email);
  if (!contact) throw new Error(`no contact for ${email}`);
  await approveContact(OWNER, contact.id);
}

function as(viewer: string) {
  jar.cookies = {};
  const token = tokens[viewer];
  if (token) jar.cookies.fs_session = token;
}

async function tripsByRef(): Promise<Map<string, Trip>> {
  const { getTrips } = await import("@/lib/trips");
  return new Map(getTrips(OWNER).map((t) => [t.id, t]));
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-entry-visibility-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "db.sqlite")}`;
  process.env.CONTACTS_ENCRYPTION_KEY = "66".repeat(32);
  process.env.SESSION_SECRET = "77".repeat(32);
  writeConfigs();
  for (const spec of TRIPS) writeTrip(spec);

  await addApprovedContact(GUEST);
  tokens.owner = await signIn(OWNER_EMAIL);
  tokens.guest = await signIn(GUEST);
  tokens.traveller = await signIn(ROBIN);
  tokens.stranger = await signIn(STRANGER);
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("what a reader is handed", () => {
  test("a read that says nothing about who is asking gets no labelled update", async () => {
    const { getAllEntries } = await import("@/lib/entries");
    const entries = getAllEntries(`${OWNER}/open-2026`);
    expect(entries).toHaveLength(1);
    expect(entries[0].slug).toBe("arrival");
  });

  for (const [viewer, byTrip] of Object.entries(EXPECTED)) {
    for (const [tripId, expected] of Object.entries(byTrip)) {
      test(`${viewer} on ${tripId}: ${expected === null ? "refused" : expected} of 3`, async () => {
        const { getAllEntries } = await import("@/lib/entries");
        const { mayReadTrip, readFor } = await import("@/lib/tripGate");
        as(viewer);
        const trip = (await tripsByRef()).get(tripId)!;
        expect(trip).toBeDefined();

        if (expected === null) {
          expect(await mayReadTrip(trip)).toBe(false);
          return;
        }
        expect(await mayReadTrip(trip)).toBe(true);
        const { read } = await readFor(trip);
        expect(getAllEntries(trip.ref, read)).toHaveLength(expected);
      });
    }
  }

  /**
   * A day with a public update and a guest update — the exact case this
   * ticket was written for. A stranger sees one; an approved guest sees both.
   */
  test("a day with a public and a guest update shows one to a stranger and both to a guest", async () => {
    const { getDays } = await import("@/lib/entries");
    const { readFor } = await import("@/lib/tripGate");
    const trip = (await tripsByRef()).get("open-2026")!;

    as("stranger");
    const { read: strangerRead } = await readFor(trip);
    const strangerDay = getDays(trip.ref, strangerRead)[0];
    expect(strangerDay.entries).toHaveLength(1);
    expect(strangerDay.entries.map((e) => e.slug)).toEqual(["arrival"]);

    as("guest");
    const { read: guestRead } = await readFor(trip);
    const guestDay = getDays(trip.ref, guestRead)[0];
    expect(guestDay.entries).toHaveLength(2);
    expect(guestDay.entries.map((e) => e.slug)).toEqual(["arrival", "arrival-guest-note"]);
  });

  /**
   * The label narrows and never widens — a `guest` update inside a `private`
   * trip is still only for the people who were there. `mayReadTrip` already
   * refuses a journal guest this whole trip (asserted in the table above);
   * this asserts the layer underneath it, the same way
   * `test/photo-visibility.test.ts` does for a photograph — that even asked
   * directly for this trip's entries, a guest-level read never turns up the
   * guest-labelled update.
   */
  test("a guest-labelled update inside a private trip stays private", async () => {
    const { getAllEntries } = await import("@/lib/entries");
    const { readerLevelFor } = await import("@/lib/tripGate");
    const trip = (await tripsByRef()).get("closed-2026")!;

    as("guest");
    expect(await readerLevelFor(trip)).toBe("public");
    const seen = getAllEntries(trip.ref, { reader: await readerLevelFor(trip) });
    expect(seen.some((e) => e.slug === "arrival-guest-note")).toBe(false);
    expect(seen.some((e) => e.slug === "arrival-private-note")).toBe(false);

    as("traveller");
    expect(await readerLevelFor(trip)).toBe("person");
    expect(getAllEntries(trip.ref, { reader: await readerLevelFor(trip) })).toHaveLength(3);
  });

  /** Fresh objects, never a mutation — the same discipline as the photograph
   * filter beside this one in lib/entries.ts. */
  test("filtering for one reader does not take the update away from the next", async () => {
    const { getAllEntries } = await import("@/lib/entries");
    const ref = `${OWNER}/open-2026`;
    expect(getAllEntries(ref, { reader: "public" })).toHaveLength(1);
    expect(getAllEntries(ref, { reader: "guest" })).toHaveLength(2);
    expect(getAllEntries(ref, { reader: "person" })).toHaveLength(3);
    expect(getAllEntries(ref, { reader: "public" })).toHaveLength(1);
  });
});

/**
 * The four surfaces built by walking every entry rather than answering one
 * page's own request — every one of them defaults to `reader: "public"` by
 * never asking who is asking at all, which is exactly the closed default
 * this feature depends on.
 */
describe("the surfaces that walk every entry", () => {
  test("the feed carries the public update and not the held-back ones", async () => {
    const { buildFeedXml } = await import("@/lib/feed");
    const xml = buildFeedXml(OWNER)!;
    expect(xml).toContain("Update 0");
    expect(xml).not.toContain("Update 1");
    expect(xml).not.toContain("Update 2");
  });

  test("the sitemap does not link the held-back updates", async () => {
    const sitemapModule = await import("@/app/sitemap");
    const entries = sitemapModule.default();
    const urls = entries.map((e) => e.url);
    expect(urls.some((u) => u.endsWith("/day/arrival"))).toBe(true);
    expect(urls.some((u) => u.endsWith("/day/arrival-guest-note"))).toBe(false);
    expect(urls.some((u) => u.endsWith("/day/arrival-private-note"))).toBe(false);
  });

  test("the search index does not carry the held-back updates", async () => {
    const { buildSearchIndexJson } = await import("@/lib/search");
    const json = buildSearchIndexJson(OWNER)!;
    expect(json).toContain("open-2026/arrival");
    expect(json).not.toContain("arrival-guest-note");
    expect(json).not.toContain("arrival-private-note");
  });

  test("the markdown twin answers as though the held-back day did not exist, and answers it for an approved guest", async () => {
    const { markdownTwin } = await import("@/lib/api/markdownTwin");

    as("stranger");
    const refused = await markdownTwin(OWNER, "open-2026", "arrival-guest-note");
    expect(refused.status).toBe(404);

    as("guest");
    const answered = await markdownTwin(OWNER, "open-2026", "arrival-guest-note");
    expect(answered.status).toBe(200);
    expect(await answered.text()).toContain("Update 1");

    // Still refused for a private-labelled update, even to an approved guest.
    const stillRefused = await markdownTwin(OWNER, "open-2026", "arrival-private-note");
    expect(stillRefused.status).toBe(404);
  });

  /**
   * A fourth surface, found while reviewing this diff rather than in the
   * original enumeration: the day's own mail announcement (`send-mail`) and
   * WhatsApp announcement (`send-whatsapp`, `lib/digest/dayWhatsapp.ts`,
   * mirrored the same way) walk a trip's *recipient list* — every approved
   * contact and traveller `mayMailTrip` lets in — and used to hand it the
   * day's title and prose with no regard for the day's own label. A `private`
   * update inside a fully public, fully open trip would have mailed every
   * approved contact of the journal, which is exactly the leak this whole
   * feature exists to close, wearing an inbox instead of a URL.
   *
   * `mailWouldCost` is the safe half to test without a mail transport: it
   * shares `recipientsFor` with the actual send, so a lower quote here is the
   * same recipients being excluded there. The approved contact (`GUEST`) is
   * not a traveller, so an unlabelled update on this open trip reaches them
   * (one billable recipient beside the owner's free copy) and a
   * `private`-labelled one does not (zero).
   */
  test("a private update is quoted, and would send, to fewer recipients than an ordinary one on the same trip", async () => {
    const { mailWouldCost } = await import("@/lib/digest/dayLetter");
    const ref = `${OWNER}/open-2026`;
    expect(await mailWouldCost(OWNER, ref, "arrival")).toBe(1);
    expect(await mailWouldCost(OWNER, ref, "arrival-private-note")).toBe(0);
  });
});

/**
 * `/<user>/me` — B632's last bullet: a reader let into a trip that is only
 * partly theirs has to be told that, or the row reads as "you can read this
 * trip" when part of it is still held back further than they have proved.
 */
/**
 * The photographs of a held-back update, which is the half that makes this a
 * feature rather than a decoration.
 *
 * B632 kept the update out of every reading path and stopped there. Its
 * pictures carry no label of their own — nothing to find in `lib/photos.ts` —
 * so the media route served them to anybody who could guess `01.jpg`, which
 * is B327's mistake on the same file by a different door: the words hidden
 * and the pictures not.
 */
describe("the photographs of a held-back update", () => {
  async function fetchPhoto(tripId: string, slug: string, file: string, query = "") {
    const { GET } = await import("@/app/[user]/media/[...path]/route");
    const segments = [tripId, slug, file];
    return GET(
      new Request(`https://example.test/${OWNER}/media/${segments.join("/")}${query}`),
      { params: Promise.resolve({ user: OWNER, path: segments }) } as never,
    );
  }

  /** The same table as the entries themselves, one row per file. */
  const EXPECTED_STATUS: Record<string, Record<string, number>> = {
    anonymous: { arrival: 200, "arrival-guest-note": 404, "arrival-private-note": 404 },
    stranger: { arrival: 200, "arrival-guest-note": 404, "arrival-private-note": 404 },
    guest: { arrival: 200, "arrival-guest-note": 200, "arrival-private-note": 404 },
    traveller: { arrival: 200, "arrival-guest-note": 200, "arrival-private-note": 200 },
    owner: { arrival: 200, "arrival-guest-note": 200, "arrival-private-note": 200 },
  };

  for (const [viewer, bySlug] of Object.entries(EXPECTED_STATUS)) {
    for (const [slug, status] of Object.entries(bySlug)) {
      test(`${viewer} asking for ${slug}'s photograph on the public trip: ${status}`, async () => {
        as(viewer);
        expect((await fetchPhoto("open-2026", slug, "01.jpg")).status).toBe(status);
      });
    }
  }

  /** A thumbnail is the same file by another spelling, and so is another case. */
  test("a resized copy and a differently-cased path are refused too", async () => {
    as("anonymous");
    expect((await fetchPhoto("open-2026", "arrival-guest-note", "01.jpg", "?w=320")).status).toBe(
      404,
    );
    expect((await fetchPhoto("open-2026", "arrival-guest-note", "01.JPG")).status).toBe(404);
  });

  /**
   * The file no gallery mentions. An original sitting in a held-back update's
   * folder is as held back as the picture beside it — and this is the case
   * a label-only check cannot reach at all, since there is no label to find.
   */
  test("a file the gallery never mentions follows the update's own folder", async () => {
    as("anonymous");
    expect((await fetchPhoto("open-2026", "arrival-guest-note", "loose.jpg")).status).toBe(404);
    expect((await fetchPhoto("open-2026", "arrival", "loose.jpg")).status).toBe(200);
  });

  /**
   * The bytes are the same for everybody who may have them; the *status* is
   * what varies, and a shared cache cannot see that.
   */
  test("a held-back update's photograph is never handed to a shared cache", async () => {
    as("traveller");
    const held = await fetchPhoto("open-2026", "arrival-private-note", "01.jpg");
    expect(held.headers.get("Cache-Control")).toBe("private, no-store");

    const open = await fetchPhoto("open-2026", "arrival", "01.jpg");
    expect(open.headers.get("Cache-Control")).toContain("public");
  });
});

describe("what the access panel says about a partly-held-back trip", () => {
  test("a stranger's row on the public trip says part of it is held back too — two of the three updates are not theirs", async () => {
    const { resolveViewer } = await import("@/lib/viewer");
    as("stranger");
    const viewer = await resolveViewer(OWNER);
    const row = viewer.trips.find((t) => t.id === "open-2026")!;
    expect(row.through).toBe("public");
    expect(row.partial).toBe(true);
  });

  test("an approved guest's row on the same trip says part of it is held back", async () => {
    const { resolveViewer } = await import("@/lib/viewer");
    as("guest");
    const viewer = await resolveViewer(OWNER);
    const row = viewer.trips.find((t) => t.id === "open-2026")!;
    // Reads as the same "public" reason the stranger's row carries — the
    // trip itself is public — but this reader's own level is "guest", which
    // sees more than a stranger and still not everything.
    expect(row.through).toBe("public");
    expect(row.partial).toBe(true);
  });

  test("the owner and a traveller see everything, so their row carries no note", async () => {
    const { resolveViewer } = await import("@/lib/viewer");
    as("owner");
    expect((await resolveViewer(OWNER)).trips.find((t) => t.id === "open-2026")?.partial).toBeUndefined();
    as("traveller");
    expect((await resolveViewer(OWNER)).trips.find((t) => t.id === "open-2026")?.partial).toBeUndefined();
  });
});

/**
 * The write door. A field an agent cannot set does not exist — there is no
 * editing interface anywhere else (AGENTS.md decision 24).
 */
describe("labelling an update over the API", () => {
  test("creation writes the label, and validation refuses \"public\"", async () => {
    const { validateEntry } = await import("@/lib/validate/entry");
    expect(validateEntry({ title: "t", date: "2026-08-25", content: "c", visibility: "guest" })).toEqual([]);
    const problems = validateEntry({
      title: "t",
      date: "2026-08-25",
      content: "c",
      visibility: "public",
    });
    expect(problems.some((p) => p.field === "visibility")).toBe(true);
  });

  test("a PATCH writes the label, and null clears it", async () => {
    const { editEntry } = await import("@/lib/api/entries");
    const { getEntryBySlug, forgetEntries } = await import("@/lib/entries");
    const ref = `${OWNER}/invited-2026`;

    const labelled = editEntry(ref, "arrival", { visibility: "private" });
    expect(labelled.ok).toBe(true);
    forgetEntries(ref);
    expect(getEntryBySlug(ref, "arrival", { reader: "person" })?.visibility).toBe("private");

    // `null` clears a label — the same override `weatherData` gets, and the
    // same reason a literal typed straight at `EditInput` cannot say it: the
    // property exists on `DraftInput` too, so the object literal is checked
    // against both halves of the intersection and the narrower one (no
    // `null`) wins. A JSON body arrives untyped and is cast at the route, so
    // this is the same cast rather than a real runtime concern.
    const cleared = editEntry(ref, "arrival", { visibility: null } as Parameters<typeof editEntry>[2]);
    expect(cleared.ok).toBe(true);
    forgetEntries(ref);
    expect(getEntryBySlug(ref, "arrival", { reader: "person" })?.visibility).toBeUndefined();
  });
});
