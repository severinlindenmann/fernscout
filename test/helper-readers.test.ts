import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache, getUser } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { migrateToLatest } from "@/lib/db/migrate";
import { runTool } from "@/lib/helper/tools";
import type { Say } from "@/lib/helper/intents";
import { writeTripFixture } from "./fixtures/content";
import { WEB_CALLER } from "./support/callers";

/**
 * Two capabilities let onto the wizard's own door — B1051. `invite_guest`,
 * `invites` and `revoke_invite` used to live here too; B2295 (one door for
 * readers, B2291) removed them — the owner decided `/<user>/studio/readers`
 * is the only place a person is let in or an invite link is made or revoked.
 * `tell_readers` is one tool for the two routes that announce a published
 * day, because a person says "tell them" and not which transport. `channels`
 * is the two switches that decide whether either one can send anything at
 * all. Neither is `approveContact` — nothing here creates a grant.
 */

const OWNER_EMAIL = "alex@example.test";

const { resolveAccess } = vi.hoisted(() => ({
  resolveAccess: vi.fn(async () => ({ email: OWNER_EMAIL as string | null })),
}));
vi.mock("@/lib/auth/handshake", () => ({ resolveAccess }));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers(),
}));

const { POST: writeDay } = await import("@/app/api/helper/[user]/day/route");
const { POST: publishDay } = await import("@/app/api/helper/[user]/day/publish/route");
const { POST: tellReadersRoute } = await import("@/app/api/helper/[user]/day/tell-readers/route");
const { POST: channelsRoute } = await import("@/app/api/helper/[user]/channels/route");

let dir: string;
const params = { params: Promise.resolve({ user: "alex" }) };
const say: Say = ((key: string, vars?: Record<string, string>) =>
  vars ? `${key} ${Object.values(vars).join(" ")}` : key) as Say;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-helper-readers-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATA_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "test.db")}`;
  process.env.SESSION_SECRET = "helper-readers-secret-b1051-00000000";
  process.env.CONTACTS_ENCRYPTION_KEY = "aa".repeat(32);
  process.env.ANTHROPIC_API_KEY = "sk-ant-test-helper-readers";
  resolveAccess.mockResolvedValue({ email: OWNER_EMAIL });

  fs.mkdirSync(path.join(dir, "alex"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "alex", "config.json"),
    JSON.stringify({
      title: "Alex",
      tagline: "t",
      owner: { name: "A B", nickname: "A", email: OWNER_EMAIL },
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
      features: { contacts: { enabled: true }, mail: { enabled: true } },
    }),
  );
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "T", url: "https://t.test" },
      features: {
        auth: { enabled: true },
        helper: { enabled: true },
        contacts: { enabled: true },
        mail: { enabled: true },
        credits: { enabled: true },
      },
    }),
  );
  writeTripFixture("alex", {
    id: "reise",
    title: "Die Reise",
    start: "2026-05-01",
    end: "2026-05-10",
    visibility: "public",
  });
  clearConfigCache();
  clearUserCache();
  await migrateToLatest(await getDatabase());
});

afterEach(async () => {
  await closeDatabase();
  delete process.env.CONTENT_DIR;
  delete process.env.DATA_DIR;
  delete process.env.DATABASE_URL;
  delete process.env.CONTACTS_ENCRYPTION_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  fs.rmSync(dir, { recursive: true, force: true });
});

/** What the browser posts when somebody presses. */
function pressed(proposal: {
  arguments: Record<string, string>;
  fields: { name: string; value: string }[];
}) {
  return {
    ...proposal.arguments,
    ...Object.fromEntries(proposal.fields.map((field) => [field.name, field.value])),
  };
}

function post(
  route: (request: Request, context: typeof params) => Promise<Response>,
  url: string,
  body: unknown,
) {
  return route(
    new Request(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    params,
  );
}

async function writeAndPublishADay(): Promise<{ trip: string; slug: string }> {
  const started = await runTool("alex", "start_day", { trip: "reise" }, say, "2026-09-07", [], "", WEB_CALLER);
  if (!started.proposal) throw new Error("start_day proposed nothing");
  // B1650's own four rows — never pre-filled on `start_day`'s card
  // (`CARD_PREFILL_TRACKS`, lib/tracks.ts) — this fixture answers them
  // directly, as a model would once it has actually asked.
  await post(writeDay, "https://t.test/api/helper/alex/day", {
    ...pressed(started.proposal),
    time: "none",
    transportMode: "none",
    tags: "none",
    visibility: "none",
  });

  // `publish_day` refuses a day that is still `NO_PROSE` with no gallery
  // (B1561) — give it real words so this fixture publishes as before. Days
  // are v2 JSON (B1598) — `content` is a plain field, not markdown prose to
  // regex against.
  const dayDir = path.join(dir, "alex", "trips", "reise", "entries");
  for (const name of fs.readdirSync(dayDir)) {
    const file = path.join(dayDir, name);
    const doc = JSON.parse(fs.readFileSync(file, "utf8")) as { content: string };
    if (doc.content === "…") {
      doc.content = "Ein Tag am See.";
      fs.writeFileSync(file, JSON.stringify(doc, null, 2) + "\n");
    }
  }

  const publishing = await runTool("alex", "publish_day", { trip: "reise" }, say, "2026-09-07", [], "", WEB_CALLER);
  if (!publishing.proposal) throw new Error("publish_day proposed nothing");
  const answered = await post(
    publishDay,
    "https://t.test/api/helper/alex/day/publish",
    pressed(publishing.proposal),
  );
  expect(answered.status).toBe(200);
  const body = (await answered.json()) as { slug: string };
  return { trip: "reise", slug: body.slug };
}

describe("invite_to_read — the one door", () => {
  test("hands over Studio › Readers and nothing else", async () => {
    const ran = await runTool("alex", "invite_to_read", {}, say, "2026-09-07", [], "", WEB_CALLER);
    expect(ran.ok).toBe(true);
    expect(ran.proposal).toBeUndefined();
    const block = ran.blocks.find((b) => b.shape === "link");
    expect(block && block.shape === "link" && block.href).toBe("/alex/studio/readers");
  });
});

describe("tell_readers", () => {
  test("a day still in draft is refused, not proposed", async () => {
    const started = await runTool("alex", "start_day", { trip: "reise" }, say, "2026-09-07", [], "", WEB_CALLER);
    await post(writeDay, "https://t.test/api/helper/alex/day", {
      ...pressed(started.proposal!),
      time: "none",
      transportMode: "none",
      tags: "none",
      visibility: "none",
    });

    const ran = await runTool("alex", "tell_readers", { trip: "reise" }, say, "2026-09-07", [], "", WEB_CALLER);
    expect(ran.proposal).toBeUndefined();
    expect(JSON.stringify(ran.blocks)).toContain("agent.tool.tellReadersDraft");
  });

  test("a published day proposes mail by default, saying how many it reaches and that it is free", async () => {
    const { trip } = await writeAndPublishADay();

    const ran = await runTool("alex", "tell_readers", { trip }, say, "2026-09-07", [], "", WEB_CALLER);
    expect(ran.proposal).toBeDefined();
    expect(ran.proposal?.sentence).toContain("agent.tool.tellReadersMail");
    // Nobody has been approved into this journal, so the only recipient is
    // the owner's own copy — always sent, and free — not "everyone".
    expect(ran.proposal?.sentence).toContain("1");

    const answered = await post(
      tellReadersRoute,
      "https://t.test/api/helper/alex/day/tell-readers",
      pressed(ran.proposal!),
    );
    expect(answered.status).toBe(200);
    const body = (await answered.json()) as { channel: string; sent: number };
    expect(body.channel).toBe("mail");
    expect(body.sent).toBe(1);
  });

  test("asking for whatsapp names its own reach and cost, separately from mail's", async () => {
    const { trip } = await writeAndPublishADay();

    const ran = await runTool(
      "alex",
      "tell_readers",
      { trip, channel: "whatsapp" },
      say,
      "2026-09-07", [], "", WEB_CALLER
    );
    // No template is configured for this server, so the honest count is
    // zero — not the mail count, which is a different function reading a
    // different list.
    expect(ran.proposal?.sentence).toContain("agent.tool.tellReadersWhatsapp");
    expect(ran.proposal?.fields.find((f) => f.name === "channel")?.value).toBe("whatsapp");
  });
});

describe("channels", () => {
  test("proposes the journal's current state, and the press changes it", async () => {
    expect(getUser("alex")?.features.mail.enabled).toBe(true);

    const ran = await runTool(
      "alex",
      "channels",
      { channel: "mail", enabled: "off" },
      say,
      "2026-09-07", [], "", WEB_CALLER
    );
    expect(ran.proposal?.sentence).toContain("agent.tool.channelsOff");

    const answered = await post(
      channelsRoute,
      "https://t.test/api/helper/alex/channels",
      pressed(ran.proposal!),
    );
    expect(answered.status).toBe(200);
    clearUserCache();
    expect(getUser("alex")?.features.mail.enabled).toBe(false);
  });

  test("a channel this server never turned on is refused, not offered as a switch", async () => {
    // The server config above never enabled whatsapp at all.
    const ran = await runTool(
      "alex",
      "channels",
      { channel: "whatsapp", enabled: "on" },
      say,
      "2026-09-07", [], "", WEB_CALLER
    );
    expect(ran.proposal).toBeUndefined();
    expect(JSON.stringify(ran.blocks)).toContain("agent.tool.channelUnavailable");
  });
});
