import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

/**
 * B619 — the owner's own details, and the journal's own name.
 *
 * `/{user}/me` has always carried a *your details* form (`ContactManage`),
 * gated on the viewer having a contact row. The owner never had one, so the
 * only reader of that page who could not edit anything about themselves was
 * the person whose journal it is — and a postcard, addressed by `contactId`,
 * could not be sent to them at all. The row is the fix, because everything
 * else already works off one: the encrypted postal address, the edit form,
 * the recipient list, both digests.
 */

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: () => {} }),
}));

const OWNER = "ana";
const OWNER_EMAIL = "ana@example.test";
const GUEST_EMAIL = "guest@example.test";

let dir: string;
let calls = 0;
function headers(extra: Record<string, string> = {}): Record<string, string> {
  calls += 1;
  return { "content-type": "application/json", "x-forwarded-for": `10.7.0.${calls % 250}`, ...extra };
}

async function tokenFor(email: string): Promise<string> {
  const { issueCode, verifyCode } = await import("@/lib/auth");
  const { code } = await issueCode(OWNER, email, "agent");
  const result = await verifyCode(OWNER, email, code, "agent");
  if (!result.ok) throw new Error(`no token for ${email}`);
  return result.token;
}

type AdminBody = {
  ok?: boolean;
  error?: string;
  contact?: { id: string; name: string | null; status: string; confirmedAt: string | null };
};

async function admin(
  body: Record<string, unknown>,
  token?: string,
): Promise<{ status: number; body: AdminBody }> {
  const { POST } = await import("@/app/api/contacts/admin/route");
  const response = await POST(
    new Request("https://example.test/api/contacts/admin", {
      method: "POST",
      headers: headers(token ? { authorization: `Bearer ${token}` } : {}),
      body: JSON.stringify({ user: OWNER, ...body }),
    }),
  );
  return { status: response.status, body: (await response.json()) as AdminBody };
}

type JournalBody = {
  ok?: boolean;
  error?: string;
  journal?: { title: string; tagline: string };
  changed?: string[];
};

async function journal(
  body: Record<string, unknown>,
  token?: string,
): Promise<{ status: number; body: JournalBody }> {
  const { PATCH } = await import("@/app/api/journal/route");
  const response = await PATCH(
    new Request("https://example.test/api/journal", {
      method: "PATCH",
      headers: headers(token ? { authorization: `Bearer ${token}` } : {}),
      body: JSON.stringify({ user: OWNER, ...body }),
    }),
  );
  return { status: response.status, body: (await response.json()) as JournalBody };
}

function writeJournalFile(title = "Two Backpacks") {
  fs.writeFileSync(
    path.join(dir, OWNER, "config.json"),
    JSON.stringify({
      title,
      tagline: "one slow loop",
      owner: { name: "Ana B", nickname: "Ana", email: OWNER_EMAIL },
      startLocation: "X",
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
      displayCurrencies: ["CHF"],
      units: "metric",
      features: { auth: { enabled: true }, contacts: { enabled: true } },
    }),
  );
}

async function clearCaches() {
  const { clearConfigCache } = await import("@/lib/config");
  const { clearUserCache } = await import("@/lib/users");
  clearConfigCache();
  clearUserCache();
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-owner-self-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATA_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "db.sqlite")}`;
  process.env.CONTACTS_ENCRYPTION_KEY = "ee".repeat(32);
  process.env.SESSION_SECRET = "ff".repeat(32);
  delete process.env.AUTH_DEV_CODE;

  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "R", url: "https://example.test", defaultUser: OWNER },
      users: { reserved: [] },
      features: {
        auth: { enabled: true },
        contacts: { enabled: true },
        mail: { enabled: true, transport: "file" },
        postcards: { enabled: true, backend: "dry-run" },
      },
    }),
  );
  fs.mkdirSync(path.join(dir, OWNER, "trips"), { recursive: true });
  writeJournalFile();
  await clearCaches();

  const { migrateToLatest } = await import("@/lib/db/migrate");
  const { getDatabase } = await import("@/lib/db");
  await migrateToLatest(await getDatabase());
});

afterAll(async () => {
  const { closeDatabase } = await import("@/lib/db");
  await closeDatabase();
  for (const key of ["CONTENT_DIR", "DATA_DIR", "DATABASE_URL", "CONTACTS_ENCRYPTION_KEY", "SESSION_SECRET"]) {
    delete process.env[key];
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("the owner's own contact row", { shuffle: false }, () => {
  test("one call makes it, already confirmed and approved, with nothing mailed", async () => {
    const created = await admin({ action: "self" }, await tokenFor(OWNER_EMAIL));
    expect(created.status).toBe(200);
    expect(created.body.ok).toBe(true);
    // Active, not pending: the session that asked is already signed in as the
    // address the row is for, so there is nothing left to prove — which is
    // the whole difference from `create`, which mails an invitation because
    // an address the owner typed is not the address proving it can be read.
    expect(created.body.contact?.status).toBe("active");
    expect(created.body.contact?.confirmedAt).not.toBeNull();
    expect(created.body.contact?.name).toBe("Ana");
    expect(fs.existsSync(path.join(dir, "mail", OWNER))).toBe(false);
  });

  test("pressing it again returns the row rather than emptying it", async () => {
    const token = await tokenFor(OWNER_EMAIL);
    const { updateContactByOwner, getContactByEmail } = await import("@/lib/contacts");
    const before = await getContactByEmail(OWNER, OWNER_EMAIL);
    await updateContactByOwner(OWNER, before!.id, {
      address: {
        name: "Ana B",
        line1: "Bahnhofstrasse 1",
        postcode: "8001",
        city: "Zürich",
        country: "CH",
      },
      wantsPostcard: true,
    });

    const again = await admin({ action: "self" }, token);
    expect(again.status).toBe(200);
    expect(again.body.contact?.id).toBe(before!.id);

    // `requestContact`'s existing-row branch would have NULLed the address and
    // cleared the consents — the trap `create` refuses with `contact_exists`.
    const after = await getContactByEmail(OWNER, OWNER_EMAIL);
    expect(after?.postalAddress?.city).toBe("Zürich");
    expect(after?.wantsPostcard).toBe(true);
  });

  test("with an address and the box ticked, a postcard can be addressed to them", async () => {
    const { postcardCandidates } = await import("@/lib/postcard/contacts");
    const { getContactByEmail } = await import("@/lib/contacts");
    const me = await getContactByEmail(OWNER, OWNER_EMAIL);
    const candidates = await postcardCandidates(OWNER);
    expect(candidates.map((c) => c.contactId)).toContain(me!.id);
    expect(candidates.find((c) => c.contactId === me!.id)?.city).toBe("Zürich");
  });

  test("a guest cannot make one for themselves", async () => {
    const refused = await admin({ action: "self" }, await tokenFor(GUEST_EMAIL));
    expect(refused.status).toBe(403);
    const { getContactByEmail } = await import("@/lib/contacts");
    expect(await getContactByEmail(OWNER, GUEST_EMAIL)).toBeNull();
  });

  test("nobody at all is refused too", async () => {
    expect((await admin({ action: "self" })).status).toBe(403);
  });
});

describe("the journal's own name", { shuffle: false }, () => {
  test("the owner can change it, and clearing it is refused", async () => {
    const token = await tokenFor(OWNER_EMAIL);

    const saved = await journal({ title: "Zwei Rucksäcke", tagline: "" }, token);
    expect(saved.status).toBe(200);
    expect(saved.body.journal?.title).toBe("Zwei Rucksäcke");
    expect(saved.body.journal?.tagline).toBe("");
    await clearCaches();
    const { getUser } = await import("@/lib/users");
    expect(getUser(OWNER)?.title).toBe("Zwei Rucksäcke");
    // An empty tagline takes the key out rather than writing "" — a journal
    // whose config says `"tagline": ""` does not load at all.
    const onDisk = JSON.parse(
      fs.readFileSync(path.join(dir, OWNER, "config.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(onDisk).not.toHaveProperty("tagline");

    const cleared = await journal({ title: "  " }, token);
    expect(cleared.status).toBe(400);
    expect(cleared.body.error).toBe("invalid_title");
    await clearCaches();
    expect(getUser(OWNER)?.title).toBe("Zwei Rucksäcke");
  });

  test("a body naming nothing this writes changes nothing", async () => {
    const token = await tokenFor(OWNER_EMAIL);
    // `owner` and `baseCurrency` are refused by `setJournalProfile` itself;
    // this route does not even forward them, so the answer is that there was
    // nothing to do — not a half-applied write.
    const empty = await journal({ owner: { email: "someone@else.test" } }, token);
    expect(empty.status).toBe(400);
    expect(empty.body.error).toBe("nothing_to_change");
    await clearCaches();
    const { getUser } = await import("@/lib/users");
    expect(getUser(OWNER)?.owner.email).toBe(OWNER_EMAIL);
  });

  test("a guest cannot rename somebody else's journal", async () => {
    const refused = await journal({ title: "Mine now" }, await tokenFor(GUEST_EMAIL));
    expect(refused.status).toBe(403);
    await clearCaches();
    const { getUser } = await import("@/lib/users");
    expect(getUser(OWNER)?.title).toBe("Zwei Rucksäcke");
  });

  test("nobody at all is refused", async () => {
    expect((await journal({ title: "Mine now" })).status).toBe(403);
  });
});

/**
 * B852 — the fields that had no web surface anywhere: `/api/journal` used
 * to forward only `title` and `tagline`, even though `setJournalProfile`
 * already validated the rest of `JOURNAL_PROFILE_FIELDS`.
 */
describe("the journal's other profile fields — B852", () => {
  test("the owner can change languages, units, currencies and their own WhatsApp number", async () => {
    const token = await tokenFor(OWNER_EMAIL);
    const saved = await journal(
      {
        locales: ["de", "en"],
        defaultLocale: "de",
        units: "imperial",
        displayCurrencies: ["CHF", "EUR"],
        startLocation: "Bern, Switzerland",
        ownerTel: "+41 76 000 00 00",
      },
      token,
    );
    expect(saved.status).toBe(200);
    expect(saved.body.changed).toEqual(
      expect.arrayContaining([
        "locales",
        "defaultLocale",
        "units",
        "displayCurrencies",
        "startLocation",
        "ownerTel",
      ]),
    );

    await clearCaches();
    const { getUser } = await import("@/lib/users");
    const after = getUser(OWNER);
    expect(after?.locales).toEqual(["de", "en"]);
    expect(after?.defaultLocale).toBe("de");
    expect(after?.units).toBe("imperial");
    expect(after?.displayCurrencies).toEqual(["CHF", "EUR"]);
    expect(after?.startLocation).toBe("Bern, Switzerland");
    expect(after?.owner.tel).toBe("41760000000");
  });

  test("visibility can be changed, and is not tangled with the plain-field save", async () => {
    const token = await tokenFor(OWNER_EMAIL);
    // Absent in the fixture, which reads as "public" — see AGENTS.md.
    const { getUser } = await import("@/lib/users");
    expect(getUser(OWNER)?.visibility).toBe("public");

    const saved = await journal({ visibility: "guest" }, token);
    expect(saved.status).toBe(200);
    expect(saved.body.changed).toEqual(["visibility"]);

    await clearCaches();
    expect(getUser(OWNER)?.visibility).toBe("guest");
  });

  test("baseCurrency is never forwarded — same as owner, above", async () => {
    // Not in `JOURNAL_PROFILE_FIELDS`, so this route filters it out before
    // `setJournalProfile` ever sees it, same as `owner` — the reason it
    // cannot be changed is on the /me screen itself (`me.journalBaseCurrencyNote`),
    // not a round trip to find out.
    const token = await tokenFor(OWNER_EMAIL);
    const refused = await journal({ baseCurrency: "USD" }, token);
    expect(refused.status).toBe(400);
    expect(refused.body.error).toBe("nothing_to_change");
  });
});
