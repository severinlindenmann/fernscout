import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { migrateToLatest } from "@/lib/db/migrate";
import { createInvite } from "@/lib/contacts/invites";
import { storeInboxFile } from "@/lib/inbox";
import { issueCode } from "@/lib/auth";
import { approveContact, confirmContact, requestContact } from "@/lib/contacts";
import type { Say } from "@/lib/helper/intents";
import { TOOLS, runTool } from "@/lib/helper/tools";
import { paintJpeg } from "./support/pictures";

/**
 * **A proposal's `arguments` alone are a body its endpoint accepts** — B935
 * and B936, and the class rather than the two rows that had it wrong.
 *
 * A proposal used to carry two descriptions of one call. `arguments` was what
 * the model typed — the trip as *"Die Reise"*, where the route needs `reise`
 * — and `fields` was what the server had resolved; `start_day`'s own
 * questions (B917) were on the card and in no argument at all. Pressing a
 * proposal exactly as its `arguments` describe it came back `unknown_trip` or
 * `incomplete_day`. The browser never saw it because `HelperAsk` merged the
 * fields back in on the way out, so the bug was invisible to the one caller
 * that happened to compensate and fatal to every other.
 *
 * The claim asserted here is registry-wide and structural: **for every write
 * tool, press it with `arguments` and nothing else, and the route does not
 * refuse the body.** The table below has to name every write tool — a new one
 * fails this file until somebody says what pressing it looks like, which is
 * the only way an assertion about "every tool" survives the next dozen rows.
 *
 * What a route says about credits, consent or a model is not this test's
 * business (`draft_words` never reaches one here). Only the refusals that
 * mean *the body was wrong* are failures, and they are listed as `SHAPE`.
 */

const OWNER_EMAIL = "alex@example.test";
const TRIP = "reise";
/** What the model would say — the *title*, never an id it composed (B927).
 *  That is precisely the value that used to end up in `arguments`. */
const AS_SAID = "Die Reise";
const DRAFT = "the-pass";
const PUBLISHED = "the-lake";

const { resolveAccess } = vi.hoisted(() => ({
  resolveAccess: vi.fn(async () => ({ email: OWNER_EMAIL as string | null })),
}));
vi.mock("@/lib/auth/handshake", () => ({ resolveAccess }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers(),
}));

/** The refusals that mean the body was wrong. Anything else — no credits, no
 *  consent, a model that never ran — is a fact about the instance, not about
 *  the proposal. */
const SHAPE = new Set([
  "invalid_json",
  "invalid_trip",
  "invalid_cost",
  "invalid_media",
  "unknown_trip",
  "unknown_day",
  "no_day_on_date",
  "incomplete_day",
  "expected_files",
  "expected_src",
  "unknown_media",
  "unknown_inbox_file",
  "no_notes",
  "nothing_to_change",
]);

/** The helper routes a proposal may name, by the path after the username. */
const ROUTES: Record<string, () => Promise<Record<string, unknown>>> = {
  "/trip": () => import("@/app/api/helper/[user]/trip/route"),
  "/trip/visibility": () => import("@/app/api/helper/[user]/trip/visibility/route"),
  "/trip/reminder": () => import("@/app/api/helper/[user]/trip/reminder/route"),
  "/trip/people": () => import("@/app/api/helper/[user]/trip/people/route"),
  "/trip/tracks": () => import("@/app/api/helper/[user]/trip/tracks/route"),
  "/day": () => import("@/app/api/helper/[user]/day/route"),
  "/day/write-day": () => import("@/app/api/helper/[user]/day/write-day/route"),
  "/day/costs": () => import("@/app/api/helper/[user]/day/costs/route"),
  "/day/publish": () => import("@/app/api/helper/[user]/day/publish/route"),
  "/day/unpublish": () => import("@/app/api/helper/[user]/day/unpublish/route"),
  "/day/attach": () => import("@/app/api/helper/[user]/day/attach/route"),
  "/day/remove-photo": () => import("@/app/api/helper/[user]/day/remove-photo/route"),
  "/inbox/discard": () => import("@/app/api/helper/[user]/inbox/discard/route"),
  "/invite": () => import("@/app/api/helper/[user]/invite/route"),
  "/trip/rates": () => import("@/app/api/helper/[user]/trip/rates/route"),
  "/trip/budget": () => import("@/app/api/helper/[user]/trip/budget/route"),
  "/invite/revoke": () => import("@/app/api/helper/[user]/invite/revoke/route"),
  "/day/tell-readers": () => import("@/app/api/helper/[user]/day/tell-readers/route"),
  "/channels": () => import("@/app/api/helper/[user]/channels/route"),
  "/journal": () => import("@/app/api/helper/[user]/journal/route"),
  "/storage/cleanup": () => import("@/app/api/helper/[user]/storage/cleanup/route"),
  "/storage": () => import("@/app/api/helper/[user]/storage/route"),
  "/keys": () => import("@/app/api/helper/[user]/keys/route"),
  "/postcard": () => import("@/app/api/helper/[user]/postcard/route"),
  "/photobook": () => import("@/app/api/helper/[user]/photobook/route"),
  "/day/undo": () => import("@/app/api/helper/[user]/day/undo/route"),
  "/day/weather": () => import("@/app/api/helper/[user]/day/weather/route"),
};

/** The gallery item `remove_photo`'s own row below removes — `DRAFT`'s own
 *  photograph, in the owner-prefixed form `AS_AUTHOR` hands back (the same
 *  form a model would have read off `GET .../days/<slug>`, never the bare
 *  `/media/...` frontmatter form). */
const DRAFT_PHOTO = `/alex/media/${TRIP}/${DRAFT}/01.jpg`;

/** What somebody says to reach each write tool. `files` is filled in per run,
 *  because an inbox id is a hash of the bytes staged in that test. */
const SAID: Record<string, Record<string, string>> = {
  create_trip: { title: "Japan", start: "2026-03-01", end: "2026-03-14" },
  edit_trip: { trip: AS_SAID, title: "Die neue Reise", start: "2026-05-02", end: "2026-05-12" },
  set_visibility: { trip: AS_SAID, visibility: "guest" },
  set_reminder: { trip: AS_SAID, enabled: "on" },
  trip_people: { trip: AS_SAID, person: "Mira", email: "mira@example.test" },
  trip_tracks: { trip: AS_SAID, costs: "off" },
  start_day: { trip: AS_SAID },
  draft_words: { trip: AS_SAID, slug: DRAFT, notes: "Regen, dann der Pass." },
  set_day_words: { trip: AS_SAID, slug: DRAFT, title: "Der Pass", content: "Ihre Worte." },
  /**
   * `category` capitalised, which is what the model really sends — B968.
   *
   * This used to pass a valid lowercase value, so the one thing that was
   * broken was the one thing the test could not see: the field drew whatever
   * the model said, the route accepts only the lowercase members of
   * `COST_CATEGORIES`, and both of a tester's costs came back `invalid_cost`
   * on a press of exactly what they were given.
   */
  add_cost: {
    trip: AS_SAID,
    slug: DRAFT,
    label: "Kaffee",
    amount: "4.50",
    currency: "CHF",
    category: "Food",
  },
  publish_day: { trip: AS_SAID, slug: DRAFT },
  unpublish_day: { trip: AS_SAID, slug: PUBLISHED },
  attach_files: { trip: AS_SAID, slug: DRAFT },
  remove_photo: { trip: AS_SAID, slug: DRAFT, src: DRAFT_PHOTO },
  discard_file: {},
  invite_guest: { name: "Mira" },
  set_rate: { trip: AS_SAID, currency: "thb", rate: "0.03" },
  set_budget: { trip: AS_SAID, total: "500", days: "5" },
  // The real id is filled in per-run, below, the same way attach_files
  // fills in `files` — an invite's id is minted, not something to guess.
  revoke_invite: {},
  tell_readers: { trip: AS_SAID, slug: PUBLISHED },
  channels: { channel: "mail", enabled: "off" },
  journal_settings: { title: "Neu", tagline: "t" },
  cleanup: {},
  buy_room: {},
  revoke_key: {},
  // `recipients` is filled in per run, from the contact `beforeEach` creates —
  // a contact id is not something anybody could say in advance.
  propose_postcards: { trip: AS_SAID, slug: DRAFT, message: "Grüße vom Pass!", from: "Alex" },
  photobook: { trip: AS_SAID, size: "square", cover: "soft" },
  // Neither route's own refusal is a SHAPE one: `undo_words` with no stash
  // yet answers `no_undo`, and `look_up_weather` with the capability off
  // (this file's config never turns it on) answers `weather_unavailable` —
  // both facts about the instance, not about the body.
  undo_words: { trip: AS_SAID, slug: DRAFT },
  look_up_weather: { trip: AS_SAID, slug: DRAFT },
};

const say: Say = ((key: string, vars?: Record<string, string>) =>
  vars ? `${key} ${Object.values(vars).join(" ")}` : key) as Say;

let dir: string;
let CONTACT_ID = "";
const params = { params: Promise.resolve({ user: "alex" }) };

/** `gallery` is only ever set for the draft day, which is what
 *  `propose_postcards` is pressed against below — a real file has to exist,
 *  since the route resolves it through `resolveMediaFile` before writing an
 *  order. */
function day(slug: string, date: string, status: "draft" | "published", gallery?: string[]) {
  fs.writeFileSync(
    path.join(dir, "alex", "trips", TRIP, "entries", `${date}-${slug}.md`),
    [
      "---",
      `title: "${slug}"`,
      `date: "${date}"`,
      `status: ${status}`,
      ...(gallery ? ["gallery:", ...gallery] : []),
      "---",
      "",
      "Worte.",
      "",
    ].join("\n"),
  );
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-proposal-args-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "test.db")}`;
  process.env.SESSION_SECRET = "helper-proposal-arguments-b935";
  process.env.CONTACTS_ENCRYPTION_KEY = "44".repeat(32);
  resolveAccess.mockResolvedValue({ email: OWNER_EMAIL });

  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "T", url: "https://t.test" },
      features: {
        auth: { enabled: true },
        helper: { enabled: true },
        contacts: { enabled: true },
        mail: { enabled: true },
        // So `buy_room` can propose at all — B1042 batch. The spend itself
        // still fails with `no_credits` (an empty balance), which is a fact
        // about the journal and not one of the SHAPE refusals below.
        credits: { enabled: true },
        postcards: { enabled: true, provider: "dry-run" },
        photobook: { enabled: true },
      },
    }),
  );
  fs.mkdirSync(path.join(dir, "alex", "trips", TRIP, "entries"), { recursive: true });
  // A postcard sheet already on disk, so `cleanup` has something to report —
  // otherwise `cleanupPlan` answers zero bytes and the tool declines itself
  // before there is anything to press (B951's rule, correctly applied).
  fs.mkdirSync(path.join(dir, "alex", "postcards", "card1"), { recursive: true });
  fs.writeFileSync(path.join(dir, "alex", "postcards", "card1", "sheet.pdf"), "x");
  fs.writeFileSync(
    path.join(dir, "alex", "config.json"),
    JSON.stringify({
      title: "Alex",
      tagline: "t",
      owner: { name: "A B", nickname: "A", email: OWNER_EMAIL },
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
      // `contacts` (and the `auth` it needs) are opt-in per journal, unlike
      // mail, which inherits the server's answer when a journal says nothing,
      // and unlike `postcards` and `photobook`, which are operator-only. A
      // journal has to say yes itself — `revoke_invite` needs it to see the
      // invite this file creates for it, and `propose_postcards` needs it to
      // see a recipient.
      //
      // One key, not two. B1027 and B1028 each added a `features:` line here
      // and the merge kept both — which git calls clean and TypeScript calls
      // TS1117, with the second silently winning had it compiled.
      features: { auth: { enabled: true }, contacts: { enabled: true } },
    }),
  );
  fs.writeFileSync(
    path.join(dir, "alex", "trips", TRIP, "trip.md"),
    [
      "---",
      `id: ${TRIP}`,
      `title: "${AS_SAID}"`,
      'start: "2026-05-01"',
      'end: "2026-05-10"',
      "visibility: private",
      "---",
      "",
      "Intro.",
      "",
    ].join("\n"),
  );
  // Two photographs on the one draft day, because two tools want different
  // things of it: propose_postcards needs a picture that is really on disk,
  // and remove_photo needs one it can name and take off again.
  day(DRAFT, "2026-05-04", "draft", [
    `  - src: "/media/${TRIP}/hafen.jpg"\n    type: image`,
    `  - src: "/media/${TRIP}/${DRAFT}/01.jpg"\n    type: image\n    width: 40\n    height: 30`,
  ]);
  day(PUBLISHED, "2026-05-05", "published");
  fs.mkdirSync(path.join(dir, "alex", "trips", TRIP, "media"), { recursive: true });
  fs.writeFileSync(path.join(dir, "alex", "trips", TRIP, "media", "hafen.jpg"), "x");
  clearConfigCache();
  clearUserCache();
  await migrateToLatest(await getDatabase());

  // A contact who asked for a real postcard, taken all the way to `active` —
  // the same three steps `test/postcard-contacts.test.ts` uses. Only
  // `propose_postcards` needs one; every other row ignores `CONTACT_ID`.
  const { contactId } = await requestContact("alex", {
    name: "Mira",
    email: "mira@example.test",
    locale: "en",
    address: {
      name: "Mira",
      line1: "Bahnhofstrasse 1",
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
  delete process.env.CONTACTS_ENCRYPTION_KEY;
  fs.rmSync(dir, { recursive: true, force: true });
});

async function press(endpoint: string, method: string, body: unknown) {
  const route = ROUTES[endpoint.replace("/api/helper/alex", "")];
  expect(route, `no route module for ${endpoint}`).toBeTypeOf("function");
  const handler = (await route()) as Record<string, (r: Request, c: unknown) => Promise<Response>>;
  return handler[method](
    new Request(`https://t.test${endpoint}`, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    params,
  );
}

const writes = TOOLS.filter((tool) => tool.kind === "write");

describe("a proposal's arguments are the press", () => {
  test("every write tool in the registry is named here", () => {
    expect(writes.map((tool) => tool.name).sort()).toEqual(Object.keys(SAID).sort());
  });

  test.each(writes.map((tool) => tool.name))("%s: arguments alone are accepted", async (name) => {
    const said = { ...SAID[name] };
    if (name === "attach_files") {
      const staged = await storeInboxFile("alex", "media", "hafen.jpg", await paintJpeg(40, 30, 1), {});
      said.files = staged.entry.id;
    }
    if (name === "revoke_invite") {
      const made = await createInvite("alex", { kind: "guest", tripId: null });
      said.invite = made.id;
    }
    if (name === "revoke_key") {
      // A real key to take back — `listSessions` is where its id comes from,
      // the same way the room's own `keys` tool would have handed it over.
      const { issueCode, listSessions, verifyCode } = await import("@/lib/auth");
      const { code } = await issueCode("alex", OWNER_EMAIL, "agent");
      await verifyCode("alex", OWNER_EMAIL, code, "agent");
      const [row] = await listSessions("alex");
      said.id = row.id;
    }
    if (name === "propose_postcards") said.recipients = CONTACT_ID;
    if (name === "discard_file") {
      const staged = await storeInboxFile("alex", "media", "boot.jpg", await paintJpeg(40, 30, 2), {});
      said.file = staged.entry.id;
    }
    const ran = await runTool("alex", name, said, say, "2026-05-06");
    const proposal = ran.proposal;
    expect(proposal, `${name} proposed nothing`).toBeTruthy();
    if (!proposal) return;

    // Half the defect, stated on its own: the card and the press are one call.
    for (const field of proposal.fields) {
      expect(proposal.arguments[field.name], `${name}.${field.name}`).toBe(field.value);
    }
    // A trip is named by its id, never by whatever the trip was called.
    if (proposal.arguments.trip) expect(proposal.arguments.trip).toBe(TRIP);

    // And the other half: the route takes the arguments and nothing else.
    const answered = await press(proposal.endpoint, proposal.method, proposal.arguments);
    const body = (await answered.json()) as { error?: string };
    expect(SHAPE, `${name} → ${answered.status} ${body.error ?? "ok"}`).not.toContain(body.error);
  });
});
