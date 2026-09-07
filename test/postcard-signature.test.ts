import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

/**
 * B629 — a postcard's default signature names the trip, not only the owner.
 *
 * `namesOnTrip` (`lib/tripPeople.ts`) is what `postcardEntryFor`
 * (`lib/postcard/entry.ts`) now reads instead of `user.owner.nickname` alone.
 * Tested at that layer rather than through the postcards API: the API also
 * requires an owner session, which would only be scaffolding around the one
 * thing this ticket changed.
 */

const OWNER = "ana";
const OWNER_EMAIL = "ana@example.test";

let dir: string;

function writeTrip(id: string, people: string) {
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
      'visibility: "private"',
      ...(people ? [people] : []),
      "---",
      "",
      "Intro.",
      "",
    ].join("\n"),
  );
}

async function letInAsBuddy(tripId: string, email: string, name: string): Promise<void> {
  const { requestContact, confirmContact, approveContact, getContactByEmail } = await import(
    "@/lib/contacts"
  );
  const { issueCode } = await import("@/lib/auth");
  const { claimTripPlace, approveTripPlaces } = await import("@/lib/tripPeople");
  await requestContact(OWNER, {
    name,
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
  const contact = await getContactByEmail(OWNER, email);
  if (!contact) throw new Error(`no contact for ${email}`);
  await claimTripPlace(OWNER, tripId, contact.id, null);
  await approveTripPlaces(OWNER, contact.id);
  const done = await approveContact(OWNER, contact.id);
  if (!done || done.contact.status !== "active") throw new Error(`approval failed for ${email}`);
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-postcard-sig-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "db.sqlite")}`;
  process.env.CONTACTS_ENCRYPTION_KEY = "77".repeat(32);
  process.env.SESSION_SECRET = "88".repeat(32);

  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "R", url: "https://example.test", defaultUser: OWNER },
      users: { reserved: [] },
      features: { auth: { enabled: true }, contacts: { enabled: true } },
    }),
  );
  fs.mkdirSync(path.join(dir, OWNER, "trips"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, OWNER, "config.json"),
    JSON.stringify({
      title: "Two Backpacks",
      tagline: "t",
      owner: { name: "Ana Owner", nickname: "Ana", email: OWNER_EMAIL },
      startLocation: "X",
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
      displayCurrencies: ["CHF"],
      units: "metric",
      features: { auth: { enabled: true }, contacts: { enabled: true } },
    }),
  );

  writeTrip("solo-2026", "");
  writeTrip(
    "bus-2026",
    ["people:", '  - name: "Bo Lind"', '    email: "bo@example.test"', '    nickname: "Bo"'].join(
      "\n",
    ),
  );
  writeTrip("buddy-2026", "");

  const { clearConfigCache } = await import("@/lib/config");
  const { clearUserCache } = await import("@/lib/users");
  clearConfigCache();
  clearUserCache();

  const { migrateToLatest } = await import("@/lib/db/migrate");
  const { getDatabase } = await import("@/lib/db");
  await migrateToLatest(await getDatabase());

  await letInAsBuddy("buddy-2026", "cara@example.test", "Cara Buddy");
});

afterAll(async () => {
  const { closeDatabase } = await import("@/lib/db");
  await closeDatabase();
  for (const key of ["CONTENT_DIR", "DATABASE_URL", "CONTACTS_ENCRYPTION_KEY", "SESSION_SECRET"]) {
    delete process.env[key];
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("namesOnTrip", () => {
  test("a trip with nobody but the owner answers exactly as it always has", async () => {
    const { namesOnTrip } = await import("@/lib/tripPeople");
    const { getTrip, tripRef } = await import("@/lib/trips");
    const trip = getTrip(tripRef(OWNER, "solo-2026"))!;
    expect(await namesOnTrip(trip)).toEqual(["Ana"]);
  });

  test("a second person in people: is proposed alongside the owner", async () => {
    const { namesOnTrip } = await import("@/lib/tripPeople");
    const { getTrip, tripRef } = await import("@/lib/trips");
    const trip = getTrip(tripRef(OWNER, "bus-2026"))!;
    const names = await namesOnTrip(trip);
    expect(names).toEqual(["Ana", "Bo"]);
    expect(names.join(" & ")).toBe("Ana & Bo");
  });

  test("a buddy who joined by link counts like anybody in people:", async () => {
    const { namesOnTrip } = await import("@/lib/tripPeople");
    const { getTrip, tripRef } = await import("@/lib/trips");
    const trip = getTrip(tripRef(OWNER, "buddy-2026"))!;
    const names = await namesOnTrip(trip);
    expect(names).toEqual(["Ana", "Cara Buddy"]);
  });

  test("no email address ever reaches the signature", async () => {
    const { namesOnTrip } = await import("@/lib/tripPeople");
    const { getTrip, tripRef } = await import("@/lib/trips");
    for (const id of ["solo-2026", "bus-2026", "buddy-2026"]) {
      const trip = getTrip(tripRef(OWNER, id))!;
      const from = (await namesOnTrip(trip)).join(" & ");
      expect(from).not.toContain("@");
    }
  });
});
