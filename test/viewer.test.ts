import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import type { Trip } from "@/lib/types";

/**
 * What the access panel is allowed to say.
 *
 * Two halves. The first extracts the *reasoning* — which trips, and why each
 * one — and tests it as a pure function, because that is the part worth
 * reading. The second runs the real `resolveViewer` against a real database
 * and a signed-in reader, because the reasoning being right is no use if the
 * lookup feeding it is wrong.
 *
 * The property that matters, in both: the panel never widens access. It
 * reports what `mayReadTrip` would already allow, and being told about a trip
 * you cannot open is the same leak as showing it in a list.
 *
 * That was a claim rather than a guarantee until B41 — the panel listed
 * `guest` trips the gate then refused (B45). It is enforced in
 * `test/access-gate.test.ts`, which runs both functions over every viewer and
 * every visibility and checks the two answers agree. This file stays as the
 * account of the panel's own reasoning.
 */

/** The session cookie the mocked `next/headers` hands back, if any. */
const jar = vi.hoisted(() => ({ token: null as string | null }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "fs_session" && jar.token ? { value: jar.token } : undefined,
  }),
}));

function trip(over: Partial<Trip>): Trip {
  return {
    id: "t", username: "alex", ref: "alex/t", rates: {}, title: "T",
    start: "2026-01-01", end: "2026-01-05", status: "past", people: [],
    accent: "sky", intro: "", visibility: "public", listed: true,
    costsVisibility: "public", ...over,
  } as Trip;
}

/** Mirrors the decision in lib/viewer.ts, which is what the panel renders. */
function through(
  t: Trip,
  opts: { owner: boolean; email: string | null; guest: boolean },
): "public" | "owner" | "traveller" | "guest" | null {
  if (opts.owner) return "owner";
  if (opts.email !== null && t.people.some((p) => p.email === opts.email)) return "traveller";
  if (t.visibility === "public" && t.listed) return "public";
  if (t.visibility === "guest" && opts.guest) return "guest";
  return null;
}

const stranger = { owner: false, email: null, guest: false };
const robin = { owner: false, email: "robin@e.com", guest: false };
const withRobin = { people: [{ name: "Robin", email: "robin@e.com" }] };

describe("which trips a reader is told about", () => {
  test("a public, listed trip is shown to anyone", () => {
    expect(through(trip({}), stranger)).toBe("public");
  });

  /** The old `unlisted`: reachable by link, never advertised — including
   * here, because a list of them is exactly what "unlisted" excludes. */
  test("a public but unlisted trip is not advertised, even to a guest", () => {
    expect(through(trip({ listed: false }), stranger)).toBeNull();
    expect(through(trip({ listed: false }), { ...robin, guest: true })).toBeNull();
  });

  test("a private trip is shown only to the people who took it", () => {
    const t = trip({ visibility: "private", listed: false, ...withRobin });
    expect(through(t, stranger)).toBeNull();
    expect(through(t, { owner: false, email: "kim@e.com", guest: true })).toBeNull();
    expect(through(t, robin)).toBe("traveller");
  });

  test("a guest trip needs an invitation, or having been there", () => {
    const t = trip({ visibility: "guest", listed: false, ...withRobin });
    expect(through(t, stranger)).toBeNull();
    expect(through(t, { owner: false, email: "kim@e.com", guest: true })).toBe("guest");
    expect(through(t, robin)).toBe("traveller");
  });

  /**
   * There is no narrower answer than "a guest of this journal". A grant used
   * to carry a trip id and nothing ever wrote one (B35), so being let in is
   * one bit: somebody who has not been let in is told nothing, whichever trip
   * it is.
   */
  test("somebody who is not a guest is not told about a guest trip", () => {
    expect(through(trip({ visibility: "guest", listed: false }), stranger)).toBeNull();
    expect(through(trip({ visibility: "guest", listed: false, id: "other-trip" }), robin))
      .toBeNull();
  });

  /**
   * B80. The owner is told about every trip in their journal, and the reason
   * is that the journal is theirs — not that they were on it. The two were one
   * arm until B80, so a trip the owner never travelled (somebody else's
   * fortnight written up here, or a `test: true` one nobody lived) carried
   * "you were on this trip".
   */
  test("the owner is told about all of them, as the owner", () => {
    const owner = { owner: true, email: "alex@e.com", guest: false };
    expect(through(trip({ visibility: "private", listed: false }), owner)).toBe("owner");
    expect(through(trip({ visibility: "guest", listed: false }), owner)).toBe("owner");
    expect(through(trip({ listed: false }), owner)).toBe("owner");
  });

  /**
   * Both true, one line — and the line is ownership. It is what actually opens
   * the trip (`isPersonOn` counts the owner's address whatever `people:` says),
   * and it is the answer that survives an edit to `people:`. Being on the trip
   * is the more interesting fact and the less accurate reason, and this panel
   * is answering "why may I read this?".
   */
  test("owning the journal beats having been on the trip", () => {
    const t = trip({
      visibility: "private",
      listed: false,
      people: [{ name: "Alex", email: "alex@e.com" }],
    });
    expect(through(t, { owner: true, email: "alex@e.com", guest: false })).toBe("owner");
  });

  /** Being on the trip is the better answer when it and an invitation are
   * both true. */
  test("having been there beats having been invited", () => {
    const t = trip({ visibility: "guest", listed: false, ...withRobin });
    expect(through(t, { ...robin, guest: true })).toBe("traveller");
  });
});

/**
 * B35: the grant lost its `trip_id`, so `resolveViewer` no longer reads
 * `access_grants` at all — approval is what writes the row *and* what sets
 * `status: "active"`, and the two paths that end an approval clear both. These
 * pin the behaviour that had to survive that: somebody let in still sees the
 * guest trip, somebody not let in still does not.
 */
describe("resolveViewer, against a database", () => {
  const OWNER = "ana";
  const OWNER_EMAIL = "ana@example.test";
  const READER = "oma@example.test";
  let dir: string;

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

  function writeTrip(id: string, visibility: "public" | "guest" | "private", people: string[] = []) {
    const root = path.join(dir, OWNER, "trips", id);
    fs.mkdirSync(path.join(root, "entries"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "trip.md"),
      [
        "---",
        `id: "${id}"`,
        `title: "${id}"`,
        'start: "2026-08-25"',
        'end: "2026-08-26"',
        'status: "past"',
        `visibility: "${visibility}"`,
        ...(visibility === "public" ? [] : ["listed: false"]),
        ...(people.length > 0
          ? ["people:", ...people.map((e) => `  - { name: "Ana", email: "${e}" }`)]
          : []),
        "---",
        "",
        "Intro.",
        "",
      ].join("\n"),
    );
  }

  /** What the panel would show for the guest-only trip, if anything. */
  async function guestTripReason(): Promise<string | null> {
    const { resolveViewer } = await import("@/lib/viewer");
    const viewer = await resolveViewer(OWNER);
    return viewer.trips.find((t) => t.id === "invited-2026")?.through ?? null;
  }

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-viewer-"));
    process.env.CONTENT_DIR = dir;
    process.env.DATABASE_URL = `sqlite:${path.join(dir, "db.sqlite")}`;
    process.env.CONTACTS_ENCRYPTION_KEY = "33".repeat(32);
    writeConfigs();
    writeTrip("open-2026", "public");
    writeTrip("invited-2026", "guest");
    // The one trip the owner put herself on `people:` for. Private, so it
    // changes nothing about what the readers below are told.
    writeTrip("ours-2026", "private", [OWNER_EMAIL]);
    const { clearConfigCache } = await import("@/lib/config");
    const { clearUserCache } = await import("@/lib/users");
    clearConfigCache();
    clearUserCache();
  });

  afterAll(async () => {
    const { closeDatabase } = await import("@/lib/db");
    await closeDatabase();
    delete process.env.CONTENT_DIR;
    delete process.env.DATABASE_URL;
    delete process.env.CONTACTS_ENCRYPTION_KEY;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("a confirmed but unapproved reader is told only about the public trip", async () => {
    const { issueCode, verifyCode } = await import("@/lib/auth");
    const { confirmContact, requestContact } = await import("@/lib/contacts");

    await requestContact(OWNER, {
      name: "Oma",
      email: READER,
      locale: "en",
      address: null,
      wantsEmailDigest: false,
      wantsPostcard: false,
      createdVia: "open",
    });
    const { code } = await issueCode(OWNER, READER, "guest");
    const confirmed = await confirmContact(OWNER, READER, code);
    expect(confirmed.ok).toBe(true);

    const signIn = await issueCode(OWNER, READER, "guest");
    const session = await verifyCode(OWNER, READER, signIn.code, "guest");
    if (!session.ok) throw new Error("sign-in failed");
    jar.token = session.token;

    const { resolveViewer } = await import("@/lib/viewer");
    const viewer = await resolveViewer(OWNER);
    expect(viewer.email).toBe(READER);
    expect(viewer.guest).toBe(false);
    expect(viewer.trips.map((t) => t.id)).toEqual(["open-2026"]);
    expect(await guestTripReason()).toBeNull();
  });

  test("approving them — which is what writes the grant — shows the guest trip", async () => {
    const { approveContact, listContacts } = await import("@/lib/contacts");
    const { getDatabase } = await import("@/lib/db");

    const contact = (await listContacts(OWNER)).find((c) => c.email === READER)!;
    await approveContact(OWNER, contact.id);

    const { db } = await getDatabase();
    const grants = await db
      .selectFrom("access_grants")
      .selectAll()
      .where("contact_id", "=", contact.id)
      .execute();
    expect(grants).toHaveLength(1);
    expect(grants[0].scope).toBe("read");

    expect(await guestTripReason()).toBe("guest");
  });

  test("taking it back — which deletes the grant — hides it again", async () => {
    const { listContacts, revokeContact } = await import("@/lib/contacts");
    const { getDatabase } = await import("@/lib/db");

    const contact = (await listContacts(OWNER)).find((c) => c.email === READER)!;
    await revokeContact(OWNER, contact.id);

    const { db } = await getDatabase();
    expect(
      await db
        .selectFrom("access_grants")
        .selectAll()
        .where("contact_id", "=", contact.id)
        .execute(),
    ).toHaveLength(0);

    expect(await guestTripReason()).toBeNull();
  });

  test("a reader with no session at all is told only about the public trip", async () => {
    jar.token = null;
    const { resolveViewer } = await import("@/lib/viewer");
    const viewer = await resolveViewer(OWNER);
    expect(viewer.email).toBeNull();
    expect(viewer.trips.map((t) => t.id)).toEqual(["open-2026"]);
  });

  /**
   * B80, against the real resolver rather than the mirror above.
   *
   * Ana is on `people:` for `ours-2026` and for neither of the others, and all
   * three read the same: the journal is hers. That is both halves of the
   * decision in one assertion — the trips she did not travel are no longer
   * claimed as hers to have been on, and the one she did travel still shows
   * ownership, because ownership is what opens it.
   */
  test("the owner reads her own journal as its owner, travelled or not", async () => {
    const { issueCode, verifyCode } = await import("@/lib/auth");
    const { code } = await issueCode(OWNER, OWNER_EMAIL, "guest");
    const session = await verifyCode(OWNER, OWNER_EMAIL, code, "guest");
    if (!session.ok) throw new Error("owner sign-in failed");
    jar.token = session.token;

    const { resolveViewer } = await import("@/lib/viewer");
    const viewer = await resolveViewer(OWNER);
    expect(viewer.owner).toBe(true);
    expect(Object.fromEntries(viewer.trips.map((t) => [t.id, t.through]))).toEqual({
      "open-2026": "owner",
      "invited-2026": "owner",
      "ours-2026": "owner",
    });
  });
});
