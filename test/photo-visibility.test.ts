import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { PHOTO_VISIBILITIES, maySeePhoto, mediaKey, parsePhotoVisibility } from "@/lib/photos";
import type { Trip } from "@/lib/types";

/**
 * One photograph held back from readers the trip lets in — B596.
 *
 * Built as the sibling of `test/draft-audience.test.ts`, deliberately and down
 * to the fixture: that ticket's failure was nine reading paths changed and a
 * tenth missed, and this feature has the same shape — a filter in the read
 * layer, a gate on the file, and every page having to ask the same question.
 * So the table runs over viewers *and* labels, and the media route is checked
 * beside the gallery rather than trusted to agree with it.
 *
 * **The two directions both matter, and they are not symmetric.** Too narrow
 * and an owner cannot see their own photograph, which is annoying. Too wide
 * and a picture somebody asked to hold back is on the open web, which is the
 * whole reason the field exists — so `anonymous` and `stranger` are the rows
 * that must never move, and a signed-in stranger sees exactly what somebody
 * who never signed in sees.
 */

const jar = vi.hoisted(() => ({ cookies: {} as Record<string, string> }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      jar.cookies[name] === undefined ? undefined : { value: jar.cookies[name] },
  }),
}));

const OWNER = "ana";
const OWNER_EMAIL = "ana@example.test";
/** Approved into the journal, and on no trip. */
const GUEST = "oma@example.test";
/** Named in the trips' `people:`, and not a contact at all. */
const ROBIN = "robin@example.test";
/** Signed in and nothing else. Anybody at all can be this. */
const STRANGER = "anyone@example.test";

/** The three photographs every day in this fixture carries. */
const PHOTOS = [
  { file: "01.jpg", label: null },
  { file: "02.jpg", label: "guest" },
  { file: "03.jpg", label: "private" },
] as const;

/**
 * `open-2026` is public and `invited-2026` is `guest`; both let a journal guest
 * at the `guest` photograph and neither lets them at the `private` one.
 *
 * `closed-2026` is the sharp one. It is `private`, so the only people through
 * the trip's own gate are the travellers and the owner — and a `guest` label
 * on a photograph inside it must not let a journal guest at anything, which is
 * what "narrows and never widens" means when the two levels disagree.
 */
const TRIPS = [
  { id: "open-2026", visibility: "public" },
  { id: "invited-2026", visibility: "guest" },
  { id: "closed-2026", visibility: "private" },
];

/**
 * How many of the three photographs each viewer sees on each trip.
 *
 * `null` means the trip's own gate refuses them outright, so the question of a
 * label never arises — asserted separately, because "sees nothing" and "may
 * not read the trip" are different facts and conflating them is how a gate
 * gets removed without a test noticing.
 */
const EXPECTED: Record<string, Record<string, number | null>> = {
  anonymous: { "open-2026": 1, "invited-2026": null, "closed-2026": null },
  // Identical to `anonymous`, deliberately and forever: proving an address is
  // free, so any diff that makes this row differ has put held-back
  // photographs within reach of anyone with an inbox.
  stranger: { "open-2026": 1, "invited-2026": null, "closed-2026": null },
  // Let into the journal: the unlabelled picture and the `guest` one, and
  // never the `private` one. Nothing at all on the `private` trip.
  guest: { "open-2026": 2, "invited-2026": 2, "closed-2026": null },
  // On the trip. All three, everywhere.
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
      title: "Two Backpacks",
      owner: { name: "Ana Meyer", nickname: "Ana", email: OWNER_EMAIL },
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

  const slug = "bangkok";
  fs.mkdirSync(path.join(root, "media", slug), { recursive: true });
  for (const photo of PHOTOS) {
    // A JPEG's first four bytes, which is all `contentTypeFor` looks at.
    fs.writeFileSync(
      path.join(root, "media", slug, photo.file),
      Buffer.from([0xff, 0xd8, 0xff, 0xdb]),
    );
  }

  fs.writeFileSync(
    path.join(root, "entries", `2026-08-25-${slug}.md`),
    [
      "---",
      'title: "Arrival"',
      'date: "2026-08-25"',
      'location: "Bangkok"',
      'country: "Thailand"',
      "gallery:",
      ...PHOTOS.flatMap((photo) => [
        `  - src: "/media/${spec.id}/${slug}/${photo.file}"`,
        '    type: "image"',
        ...(photo.label ? [`    visibility: "${photo.label}"`] : []),
      ]),
      "---",
      "",
      "Arrival.",
      "",
    ].join("\n"),
  );
}

async function signIn(email: string): Promise<string> {
  const { issueCode, verifyCode } = await import("@/lib/auth");
  const { code } = await issueCode(OWNER, email, "guest");
  const session = await verifyCode(OWNER, email, code, "guest");
  if (!session.ok) throw new Error(`sign-in failed for ${email}: ${session.reason}`);
  return session.token;
}

/** Confirmed their address, and approved by the owner: a guest of the journal. */
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
    wantsEmailDigest: false,
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
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-photo-visibility-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "db.sqlite")}`;
  process.env.CONTACTS_ENCRYPTION_KEY = "44".repeat(32);
  process.env.SESSION_SECRET = "55".repeat(32);
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

/**
 * The vocabulary itself, with no journal and no session in sight. Every gate
 * below is a wrapper around these three functions, so a rule that is wrong
 * here is wrong everywhere at once.
 */
describe("the whole file, kept in written order", { shuffle: false }, () => {
  describe("the label, on its own", () => {
    test("a src matches whichever side of the API it was seen from", () => {
      expect(mediaKey("/ana/media/open-2026/bangkok/01.jpg")).toBe("open-2026/bangkok/01.jpg");
      expect(mediaKey("/media/open-2026/bangkok/01.jpg")).toBe("open-2026/bangkok/01.jpg");
      expect(mediaKey("open-2026/bangkok/01.jpg")).toBe("open-2026/bangkok/01.jpg");
    });

    test("an unrecognised word reads as private, never as no label", () => {
      for (const word of PHOTO_VISIBILITIES) expect(parsePhotoVisibility(word)).toBe(word);
      expect(parsePhotoVisibility(undefined)).toBeUndefined();
      expect(parsePhotoVisibility(null)).toBeUndefined();
      expect(parsePhotoVisibility("")).toBeUndefined();
      // A typo must not publish somebody's photograph, and `public` is a typo
      // here: a label narrows, so there is no such value to obey.
      expect(parsePhotoVisibility("privte")).toBe("private");
      expect(parsePhotoVisibility("public")).toBe("private");
      expect(parsePhotoVisibility(true)).toBe("private");
    });

    test("the levels are ordered, and an unlabelled photograph is everybody's", () => {
      expect(maySeePhoto(undefined, "public")).toBe(true);
      expect(maySeePhoto("guest", "public")).toBe(false);
      expect(maySeePhoto("guest", "guest")).toBe(true);
      expect(maySeePhoto("guest", "person")).toBe(true);
      expect(maySeePhoto("private", "guest")).toBe(false);
      expect(maySeePhoto("private", "person")).toBe(true);
    });
  });

  describe("what a reader is handed", () => {
    /**
     * The closed default, which is the whole design: some forty-five places read
     * `entry.gallery`, and a call that says nothing about its reader has to get
     * the safe answer rather than the generous one. B327 is what the other way
     * round costs.
     */
    test("a read that says nothing about who is asking gets no labelled photograph", async () => {
      const { getDays } = await import("@/lib/entries");
      const days = getDays(`${OWNER}/open-2026`);
      expect(days[0].lead.gallery).toHaveLength(1);
      expect(days[0].lead.gallery[0].src).toContain("01.jpg");
    });

    for (const [viewer, byTrip] of Object.entries(EXPECTED)) {
      for (const [tripId, expected] of Object.entries(byTrip)) {
        test(`${viewer} on ${tripId}: ${expected === null ? "refused" : expected} of 3`, async () => {
          const { getDays } = await import("@/lib/entries");
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
          expect(getDays(trip.ref, read)[0].lead.gallery).toHaveLength(expected);
        });
      }
    }

    /**
     * The label narrows and never widens, stated as the one case where the two
     * levels disagree: a `guest` photograph inside a `private` trip.
     *
     * A journal guest is refused by the trip's gate above, so this asserts the
     * layer underneath it — that even asked directly, the read layer does not
     * hand them the picture. Two answers rather than one, because a gate that is
     * later moved or widened must not silently make this true.
     */
    test("a guest label inside a private trip is still only for the people who were there", async () => {
      const { readerLevelFor } = await import("@/lib/tripGate");
      const trip = (await tripsByRef()).get("closed-2026")!;

      as("guest");
      expect(await readerLevelFor(trip)).toBe("public");

      as("traveller");
      expect(await readerLevelFor(trip)).toBe("person");
    });

    /**
     * `readAllEntries` caches the parse for the life of the process and hands
     * the same objects to every request, so a filter that stripped in place
     * would hide the photograph from the owner too — for as long as the server
     * runs, and only on the second request, which is the worst way to find out.
     */
    test("filtering for one reader does not take the photograph away from the next", async () => {
      const { getDays } = await import("@/lib/entries");
      const ref = `${OWNER}/open-2026`;
      expect(getDays(ref, { reader: "public" })[0].lead.gallery).toHaveLength(1);
      expect(getDays(ref, { reader: "guest" })[0].lead.gallery).toHaveLength(2);
      expect(getDays(ref, { reader: "person" })[0].lead.gallery).toHaveLength(3);
      // And again, in the other order.
      expect(getDays(ref, { reader: "public" })[0].lead.gallery).toHaveLength(1);
    });

    /** The counts the gallery and the hero render come off the same read. */
    test("the trip's own media count follows the reader", async () => {
      const { getTripStats } = await import("@/lib/entries");
      const ref = `${OWNER}/open-2026`;
      expect(getTripStats(ref, { reader: "public" }).totalMedia).toBe(1);
      expect(getTripStats(ref, { reader: "person" }).totalMedia).toBe(3);
    });
  });

  /**
   * The file itself, which is the half that makes this a feature rather than a
   * decoration. Keeping a picture out of the gallery leaves it one guessable URL
   * away, and the URLs here are `01.jpg`, `02.jpg`, `03.jpg`.
   */
  describe("the photograph itself", () => {
    async function fetchPhoto(tripId: string, file: string, query = "") {
      const { GET } = await import("@/app/[user]/media/[...path]/route");
      const segments = [tripId, "bangkok", file];
      return GET(
        new Request(`https://example.test/${OWNER}/media/${segments.join("/")}${query}`),
        { params: Promise.resolve({ user: OWNER, path: segments }) } as never,
      );
    }

    const EXPECTED_STATUS: Record<string, Record<string, number>> = {
      anonymous: { "01.jpg": 200, "02.jpg": 404, "03.jpg": 404 },
      stranger: { "01.jpg": 200, "02.jpg": 404, "03.jpg": 404 },
      guest: { "01.jpg": 200, "02.jpg": 200, "03.jpg": 404 },
      traveller: { "01.jpg": 200, "02.jpg": 200, "03.jpg": 200 },
      owner: { "01.jpg": 200, "02.jpg": 200, "03.jpg": 200 },
    };

    for (const [viewer, byFile] of Object.entries(EXPECTED_STATUS)) {
      for (const [file, status] of Object.entries(byFile)) {
        test(`${viewer} asking for ${file} on the public trip: ${status}`, async () => {
          as(viewer);
          expect((await fetchPhoto("open-2026", file)).status).toBe(status);
        });
      }
    }

    /** Same route, same gate — a thumbnail is not a way round it. */
    test("a resized copy is refused too", async () => {
      as("anonymous");
      expect((await fetchPhoto("open-2026", "03.jpg", "?w=320")).status).toBe(404);
    });

    /**
     * Nor is a different spelling of the same file.
     *
     * On a case-insensitive volume — APFS, so every Mac this is developed on —
     * `03.JPG` opens `03.jpg`, and a byte comparison against the gallery's `src`
     * called them different photographs and served the file. Asserted on both
     * kinds of volume: where the name does not resolve the answer is 404 for
     * being absent, and where it does the answer is 404 for being held back.
     * The one status this must never be is 200.
     */
    test("a differently-cased path is not a way round it", async () => {
      as("anonymous");
      expect((await fetchPhoto("open-2026", "03.JPG")).status).toBe(404);
    });

    /**
     * The bytes are the same for everybody who may have them; the *status* is
     * what varies. A shared cache cannot see that, so the one 200 must not be
     * storable.
     */
    test("a labelled photograph is never handed to a shared cache", async () => {
      as("traveller");
      const held = await fetchPhoto("open-2026", "03.jpg");
      expect(held.headers.get("Cache-Control")).toBe("private, no-store");

      const open = await fetchPhoto("open-2026", "01.jpg");
      expect(open.headers.get("Cache-Control")).toContain("public");
    });
  });

  /**
   * The write door. A field an agent cannot set does not exist — there is no
   * editing interface anywhere else (AGENTS.md decision 24), so a label that can
   * only be typed into a file by hand is a label nobody outside this checkout
   * will ever apply.
   */
  describe("labelling a photograph over the API", { shuffle: false }, () => {
    test("a PATCH writes the label, and null clears it", async () => {
      const { editEntry } = await import("@/lib/api/entries");
      const { getEntryBySlug, forgetEntries } = await import("@/lib/entries");
      const ref = `${OWNER}/invited-2026`;
      const src = `/media/invited-2026/bangkok/01.jpg`;

      expect(editEntry(ref, "bangkok", { photoVisibility: { [src]: "private" } }).ok).toBe(true);
      forgetEntries(ref);
      const held = getEntryBySlug(ref, "bangkok", { reader: "person" })!;
      expect(held.gallery.find((g) => g.src.endsWith("01.jpg"))?.visibility).toBe("private");
      // And it is gone for a reader below that level, through the same read
      // layer the pages use.
      expect(getEntryBySlug(ref, "bangkok", { reader: "guest" })!.gallery).toHaveLength(1);

      expect(editEntry(ref, "bangkok", { photoVisibility: { [src]: null } }).ok).toBe(true);
      forgetEntries(ref);
      const cleared = getEntryBySlug(ref, "bangkok", { reader: "person" })!;
      expect(cleared.gallery.find((g) => g.src.endsWith("01.jpg"))?.visibility).toBeUndefined();
    });

    /**
     * The key is forgiving about the owner prefix, because a caller sending back
     * what `GET .../days/<slug>` handed it has to work — that reads
     * `/<user>/media/…` while the file on disk carries `/media/…`.
     */
    test("the src may be spelled either way", async () => {
      const { editEntry } = await import("@/lib/api/entries");
      const { getEntryBySlug, forgetEntries } = await import("@/lib/entries");
      const ref = `${OWNER}/invited-2026`;

      const result = editEntry(ref, "bangkok", {
        photoVisibility: { [`/${OWNER}/media/invited-2026/bangkok/02.jpg`]: "private" },
      });
      expect(result.ok).toBe(true);
      forgetEntries(ref);
      const entry = getEntryBySlug(ref, "bangkok", { reader: "person" })!;
      expect(entry.gallery.find((g) => g.src.endsWith("02.jpg"))?.visibility).toBe("private");
    });

    /**
     * Refused rather than ignored, and this matters more here than for a
     * caption: "I have marked that photograph private" followed by nothing
     * landing is the worst answer this feature could give.
     */
    test("an unknown word and an unknown photograph are both refused", async () => {
      const { validateEntryEdit } = await import("@/lib/validate/entry");
      const known = ["/ana/media/invited-2026/bangkok/01.jpg"];

      expect(
        validateEntryEdit({ photoVisibility: { [known[0]]: "private" } }, undefined, known),
      ).toEqual([]);
      expect(validateEntryEdit({ photoVisibility: { [known[0]]: null } }, undefined, known)).toEqual(
        [],
      );

      const widened = validateEntryEdit(
        { photoVisibility: { [known[0]]: "public" } },
        undefined,
        known,
      );
      expect(widened).toHaveLength(1);
      expect(widened[0].expected).toContain("null");

      const unknownSrc = validateEntryEdit(
        { photoVisibility: { "/ana/media/invited-2026/bangkok/99.jpg": "private" } },
        undefined,
        known,
      );
      expect(unknownSrc).toHaveLength(1);
      expect(unknownSrc[0].expected).toContain("this day's gallery actually has");

      expect(validateEntryEdit({ photoVisibility: "private" }, undefined, known)).toHaveLength(1);
    });

    test("the media door takes one label per file, in the files' order", async () => {
      const { visibilitiesFor } = await import("@/lib/validate/media");
      expect(visibilitiesFor(undefined, 2)).toEqual({ ok: true, visibilities: [] });
      expect(visibilitiesFor(["", "private"], 2)).toEqual({
        ok: true,
        visibilities: [undefined, "private"],
      });
      // More labels than files is refused rather than misaligned: a label on the
      // wrong photograph is worse than no label.
      expect(visibilitiesFor(["private", "guest", "guest"], 2).ok).toBe(false);
      expect(visibilitiesFor(["public"], 1).ok).toBe(false);
      expect(visibilitiesFor("private", 1).ok).toBe(false);
    });
  });
});
