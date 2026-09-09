import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { migrateToLatest } from "@/lib/db/migrate";
import { issueCode } from "@/lib/auth";
import { approveContact, confirmContact, requestContact } from "@/lib/contacts";
import { TOOLS, runTool } from "@/lib/helper/tools";
import type { Say } from "@/lib/helper/intents";

/**
 * Printed things, from the conversation's side — B434 and the photobook
 * counterpart of it, `lib/helper/tools/areas/printed.ts`.
 *
 * The two claims that matter more than the others: **an address never
 * appears in what an agent reads**, and **a card is never described as sent**
 * — both stated at length in AGENTS.md, and both checked here explicitly
 * rather than trusted from reading the code once.
 */

const OWNER_EMAIL = "alex@example.test";
const ADDRESS_STREET = "Bahnhofstrasse 1";

const { resolveAccess } = vi.hoisted(() => ({
  resolveAccess: vi.fn(async () => ({ email: OWNER_EMAIL as string | null })),
}));
vi.mock("@/lib/auth/handshake", () => ({ resolveAccess }));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers(),
}));

const { POST: postcardRoute } = await import("@/app/api/helper/[user]/postcard/route");
const { POST: photobookRoute } = await import("@/app/api/helper/[user]/photobook/route");

let dir: string;
let CONTACT_ID = "";
const params = { params: Promise.resolve({ user: "alex" }) };
const say: Say = ((key: string, vars?: Record<string, string>) =>
  vars ? `${key} ${Object.values(vars).join(" ")}` : key) as Say;

async function rows() {
  const { db } = (await getDatabase())!;
  return db.selectFrom("helper_sessions").selectAll().where("kind", "=", "press").execute();
}

function post(
  route: (request: Request, context: typeof params) => Promise<Response>,
  path_: string,
  body: unknown,
) {
  return route(
    new Request(`https://t.test${path_}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    params,
  );
}

/** What the browser posts when somebody presses — arguments verbatim, as
 *  `test/helper-publish-press.test.ts` and B935 describe it. */
function pressed(proposal: { arguments: Record<string, string> }) {
  return { ...proposal.arguments };
}

async function propose(tool: string, args: Record<string, string> = {}) {
  const ran = await runTool("alex", tool, args, say, "2026-09-07");
  return ran;
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-printed-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "test.db")}`;
  process.env.SESSION_SECRET = "helper-printed-secret-b1042";
  process.env.CONTACTS_ENCRYPTION_KEY = "55".repeat(32);
  resolveAccess.mockResolvedValue({ email: OWNER_EMAIL });

  fs.mkdirSync(path.join(dir, "alex", "trips", "reise", "entries"), { recursive: true });
  fs.mkdirSync(path.join(dir, "alex", "trips", "reise", "media"), { recursive: true });
  fs.writeFileSync(path.join(dir, "alex", "trips", "reise", "media", "hafen.jpg"), "x");
  fs.writeFileSync(
    path.join(dir, "alex", "config.json"),
    JSON.stringify({
      title: "Alex",
      tagline: "t",
      owner: { name: "A B", nickname: "A", email: OWNER_EMAIL },
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
      // `contacts` (and the `auth` it needs) are not operator-only, unlike
      // `postcards` and `photobook` below — a journal has to say yes to them
      // itself, the same way `test/postcard-texts.test.ts` sets this up.
      features: { auth: { enabled: true }, contacts: { enabled: true } },
    }),
  );
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "T", url: "https://t.test" },
      features: {
        auth: { enabled: true },
        contacts: { enabled: true },
        postcards: { enabled: true, provider: "dry-run" },
        photobook: { enabled: true },
      },
    }),
  );
  fs.writeFileSync(
    path.join(dir, "alex", "trips", "reise", "trip.md"),
    ["---", "id: reise", "title: Die Reise", 'start: "2026-05-01"', 'end: "2026-05-10"', "visibility: private", "---", "", "Intro."].join(
      "\n",
    ),
  );
  fs.writeFileSync(
    path.join(dir, "alex", "trips", "reise", "entries", "2026-05-04-pass.md"),
    [
      "---",
      "title: Der Pass",
      'date: "2026-05-04"',
      "status: draft",
      "gallery:",
      '  - src: "/media/reise/hafen.jpg"',
      "    type: image",
      "---",
      "",
      "Der Regen hörte am Nachmittag auf.",
      "",
    ].join("\n"),
  );
  clearConfigCache();
  clearUserCache();
  await migrateToLatest(await getDatabase());

  const { contactId } = await requestContact("alex", {
    name: "Mira",
    email: "mira@example.test",
    locale: "en",
    address: {
      name: "Mira",
      line1: ADDRESS_STREET,
      line2: "",
      postcode: "8001",
      city: "Zurich",
      country: "Switzerland",
      tel: "",
    },
    wantsEmailDigest: false,
    wantsPostcard: true,
    createdVia: "owner",
  });
  const { code } = await issueCode("alex", "mira@example.test", "guest");
  await confirmContact("alex", "mira@example.test", code);
  const approved = await approveContact("alex", contactId!);
  CONTACT_ID = approved?.contact.id ?? "";
});

afterEach(async () => {
  await closeDatabase();
  delete process.env.CONTENT_DIR;
  delete process.env.DATABASE_URL;
  delete process.env.SESSION_SECRET;
  delete process.env.CONTACTS_ENCRYPTION_KEY;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("postcard_recipients — a name, a town and a country, never a street", () => {
  test("the contact who asked is offered", async () => {
    const ran = await propose("postcard_recipients");
    const result = ran.result as { available: boolean; recipients: { contactId: string; name: string }[] };
    expect(result.available).toBe(true);
    expect(result.recipients).toHaveLength(1);
    expect(result.recipients[0].contactId).toBe(CONTACT_ID);
  });

  /**
   * The claim this whole area rests on. Not "the code looks like it never
   * reads `line1`" but "the string this tool actually handed back does not
   * contain the street" — in the raw result, and in the block drawn from it.
   */
  test("no postal address appears anywhere in what this tool returns", async () => {
    const ran = await propose("postcard_recipients");
    expect(JSON.stringify(ran.result)).not.toContain(ADDRESS_STREET);
    expect(JSON.stringify(ran.blocks)).not.toContain(ADDRESS_STREET);
  });

  test("off when postcards is not switched on, rather than broken", async () => {
    fs.writeFileSync(
      path.join(dir, "config.json"),
      JSON.stringify({
        site: { name: "T", url: "https://t.test" },
        features: { auth: { enabled: true }, helper: { enabled: true }, contacts: { enabled: true } },
      }),
    );
    clearConfigCache();
    const ran = await propose("postcard_recipients");
    expect((ran.result as { available: boolean }).available).toBe(false);
    // Nothing to choose from: no card at all, not a card saying it is broken.
    expect(ran.blocks).toEqual([]);
  });
});

describe("propose_postcards — a preview waiting, never a claim of sending", () => {
  test("pressing what the conversation offered writes a real, pending order", async () => {
    const proposed = await propose("propose_postcards", {
      trip: "reise",
      slug: "pass",
      message: "Grüße vom Pass!",
      from: "Alex",
      recipients: CONTACT_ID,
    });
    expect(proposed.proposal).toBeTruthy();
    const proposal = proposed.proposal!;
    expect(proposal.arguments.photo).toBe("hafen.jpg");

    const answered = await post(postcardRoute, "/api/helper/alex/postcard", pressed(proposal));
    expect(answered.status).toBe(201);
    const body = (await answered.json()) as { ok: boolean; id: string; url: string };
    expect(body.ok).toBe(true);
    expect(body.url).toContain(`/alex/postcards/${body.id}`);
  });

  /**
   * The one sentence AGENTS.md is explicit about: "Hand over the URL and say
   * a preview is waiting. Do not say the cards have been sent." Checked as a
   * word search rather than trusted from having written it once.
   */
  test("the done sentence never claims the cards were sent", async () => {
    const proposed = await propose("propose_postcards", {
      trip: "reise",
      slug: "pass",
      message: "Grüße vom Pass!",
      from: "Alex",
      recipients: CONTACT_ID,
    });
    const done = proposed.proposal!.done;
    expect(done).not.toMatch(/\b(sent|mailed|posted|delivered)\b/i);
  });

  test("a refusal from the route leaves a row, same as any other write tool", async () => {
    const answered = await post(postcardRoute, "/api/helper/alex/postcard", {
      trip: "reise",
      slug: "pass",
      photo: "hafen.jpg",
      message: "Hallo",
      from: "Alex",
      recipients: "not-a-real-contact",
    });
    expect(answered.status).toBe(400);
    expect((await answered.json()).error).toBe("unknown_recipient");

    const pressed_ = await rows();
    expect(pressed_).toHaveLength(1);
    expect(pressed_[0]).toMatchObject({ ok: 0, error: "unknown_recipient", proposed: "propose_postcards" });
  });

  test("absent rather than broken when postcards is off", async () => {
    fs.writeFileSync(
      path.join(dir, "config.json"),
      JSON.stringify({
        site: { name: "T", url: "https://t.test" },
        features: { auth: { enabled: true }, helper: { enabled: true }, contacts: { enabled: true } },
      }),
    );
    clearConfigCache();
    const ran = await propose("propose_postcards", { trip: "reise", slug: "pass" });
    // No button at all — a sentence declining itself, not a card that fails
    // when pressed.
    expect(ran.proposal).toBeUndefined();
    expect(ran.blocks).toEqual([{ shape: "say", text: "agent.tool.postcardsUnavailable" }]);
  });
});

describe("photobook — a link handed over, nothing built or charged", () => {
  test("pressing what the conversation offered hands back the maker's URL", async () => {
    const proposed = await propose("photobook", { trip: "reise", size: "square", cover: "soft" });
    const proposal = proposed.proposal!;
    const answered = await post(photobookRoute, "/api/helper/alex/photobook", pressed(proposal));
    expect(answered.status).toBe(201);
    const body = (await answered.json()) as { ok: boolean; url: string };
    expect(body.ok).toBe(true);
    expect(body.url).toBe("https://t.test/alex/trips/reise/photobook");
  });

  test("absent rather than broken when photobook is off", async () => {
    fs.writeFileSync(
      path.join(dir, "config.json"),
      JSON.stringify({
        site: { name: "T", url: "https://t.test" },
        features: { auth: { enabled: true }, helper: { enabled: true }, contacts: { enabled: true } },
      }),
    );
    clearConfigCache();
    const ran = await propose("photobook", { trip: "reise" });
    expect(ran.proposal).toBeUndefined();
    expect(ran.blocks).toEqual([{ shape: "say", text: "agent.tool.photobookUnavailable" }]);
  });
});

describe("print_order — reading either kind of order back by id", () => {
  test("a postcard order just proposed is found", async () => {
    const proposed = await propose("propose_postcards", {
      trip: "reise",
      slug: "pass",
      message: "Grüße vom Pass!",
      from: "Alex",
      recipients: CONTACT_ID,
    });
    const answered = await post(postcardRoute, "/api/helper/alex/postcard", pressed(proposed.proposal!));
    const { id } = (await answered.json()) as { id: string };

    const ran = await propose("print_order", { id });
    expect(ran.result).toMatchObject({ found: true, kind: "postcard", status: "draft" });
  });

  test("an id nobody wrote says so honestly", async () => {
    const ran = await propose("print_order", { id: "not-a-real-order" });
    expect(ran.result).toMatchObject({ found: false });
  });
});

describe("nothing here is called anything a send tool would be called", () => {
  test("the registry names no tool 'send'", () => {
    expect(TOOLS.map((tool) => tool.name).filter((name) => name.includes("send"))).toEqual([]);
  });
});
