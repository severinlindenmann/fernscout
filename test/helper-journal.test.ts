import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache, getUser } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { migrateToLatest } from "@/lib/db/migrate";
import { TOOLS, runTool } from "@/lib/helper/tools";
import type { Say } from "@/lib/helper/intents";
import { translateIn } from "@/lib/locales";
import { WEB_CALLER } from "./support/callers";

/**
 * The journal's own account, and what it can do to itself — B1042 batch.
 *
 * Same shape as `test/helper-publish-press.test.ts`: drive the tool, press
 * with `proposal.arguments` verbatim, and read the route's own answer —
 * never a mock of one. `say` is the real dictionary rather than the
 * key-echoing stub most of these tests use, because two of the assertions
 * below are about the actual sentence a person reads: that `keys` never
 * prints a token, and that `buy_credits` never claims a credit was added.
 * A stub that returns its own key could not fail either check.
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

const { POST: postJournal } = await import("@/app/api/helper/[user]/journal/route");
const { POST: postCleanup } = await import("@/app/api/helper/[user]/storage/cleanup/route");
const { POST: postStorage } = await import("@/app/api/helper/[user]/storage/route");
const { GET: getKeys, POST: postKeys } = await import("@/app/api/helper/[user]/keys/route");

let dir: string;
const params = { params: Promise.resolve({ user: "alex" }) };
const say: Say = ((key: string, vars?: Record<string, string>) =>
  translateIn("en", key as Parameters<typeof translateIn>[1], vars)) as Say;

function writeSiteConfig(credits: boolean) {
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "T", url: "https://t.test" },
      features: {
        auth: { enabled: true },
        helper: { enabled: true },
        credits: { enabled: credits },
      },
    }),
  );
  clearConfigCache();
}

/**
 * What a press actually sends — B1659.
 *
 * `HelperAsk.tsx` seeds its `values` state from every field, fixed ones
 * included (`Object.fromEntries(fields.map((f) => [f.name, f.value]))`), and
 * posts `{ ...proposal.arguments, ...values }`. `proposal.arguments` alone
 * (what these tests used to post) drops `buy_room`'s minted `id`, so a test
 * built on it would never exercise the idempotency guard at all.
 */
function sentFor(proposal: { arguments: Record<string, string>; fields: { name: string; value: string }[] }) {
  return {
    ...proposal.arguments,
    ...Object.fromEntries(proposal.fields.map((f) => [f.name, f.value])),
  };
}

async function pressRows(tool: string) {
  const { db } = await getDatabase();
  return db
    .selectFrom("helper_sessions")
    .selectAll()
    .where("kind", "=", "press")
    .where("proposed", "=", tool)
    .execute();
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-helper-journal-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "test.db")}`;
  process.env.SESSION_SECRET = "helper-journal-secret-b1042";
  resolveAccess.mockResolvedValue({ email: OWNER_EMAIL });

  fs.mkdirSync(path.join(dir, "alex", "trips"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "alex", "config.json"),
    JSON.stringify({
      title: "Alex",
      tagline: "t",
      owner: { name: "A B", nickname: "A", email: OWNER_EMAIL },
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
      // `auth` is instance-only now (decision 5, B1666) — the server's own
      // `features.auth` in `writeSiteConfig` below is what `keys` and
      // `revoke_key` actually key off. Harmless and no longer load-bearing,
      // kept only so this fixture still reads like a real journal's file.
      features: { auth: { enabled: true } },
    }),
  );
  writeSiteConfig(true);
  clearUserCache();
  await migrateToLatest(await getDatabase());
});

afterEach(async () => {
  await closeDatabase();
  delete process.env.CONTENT_DIR;
  delete process.env.DATABASE_URL;
  delete process.env.SESSION_SECRET;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("journal_settings", () => {
  test("proposes the current title, and the press changes it", async () => {
    const ran = await runTool("alex", "journal_settings", { title: "Neuer Titel" }, say, "2026-05-06", [], "", WEB_CALLER);
    expect(ran.proposal).toBeTruthy();
    const proposal = ran.proposal!;
    expect(proposal.arguments.title).toBe("Neuer Titel");
    expect(proposal.arguments.tagline).toBe("t"); // the journal's own, untouched

    const response = await postJournal(
      new Request("https://t.test/api/helper/alex/journal", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(proposal.arguments),
      }),
      params,
    );
    expect(response.status).toBe(200);
    clearUserCache();
    expect(getUser("alex")?.title).toBe("Neuer Titel");
  });

  test("no capability switch reaches the route from this tool", () => {
    const tool = TOOLS.find((one) => one.name === "journal_settings")!;
    expect(Object.keys(tool.properties)).toEqual(["title", "tagline"]);
  });
});

describe("cleanup", () => {
  test("declines itself when there is nothing generated to remove", async () => {
    const ran = await runTool("alex", "cleanup", {}, say, "2026-05-06", [], "", WEB_CALLER);
    expect(ran.proposal).toBeUndefined();
    expect((ran.result as { proposed: boolean }).proposed).toBe(false);
  });

  test("the preview says days and photographs are untouched, and the press removes only the sheet", async () => {
    const sheet = path.join(dir, "alex", "postcards", "card1", "sheet.pdf");
    fs.mkdirSync(path.dirname(sheet), { recursive: true });
    fs.writeFileSync(sheet, "x");

    const ran = await runTool("alex", "cleanup", {}, say, "2026-05-06", [], "", WEB_CALLER);
    const proposal = ran.proposal!;
    expect(proposal).toBeTruthy();
    const preview = ran.blocks.find((b) => b.shape === "preview");
    expect(preview?.lines.join(" ")).toMatch(/day/i);
    expect(preview?.lines.join(" ")).toMatch(/photograph/i);

    const response = await postCleanup(
      new Request("https://t.test/api/helper/alex/storage/cleanup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(proposal.arguments),
      }),
      params,
    );
    expect(response.status).toBe(200);
    expect(fs.existsSync(sheet)).toBe(false);
  });
});

describe("buy_room", () => {
  test("declines itself when this server does not charge for anything", async () => {
    writeSiteConfig(false);
    const ran = await runTool("alex", "buy_room", {}, say, "2026-05-06", [], "", WEB_CALLER);
    expect(ran.proposal).toBeUndefined();
  });

  test("proposes the cost and the balance, and a refused press leaves a row", async () => {
    const ran = await runTool("alex", "buy_room", {}, say, "2026-05-06", [], "", WEB_CALLER);
    const proposal = ran.proposal!;
    expect(proposal).toBeTruthy();
    const preview = ran.blocks.find((b) => b.shape === "preview");
    expect(preview?.lines.join(" ")).toMatch(/50/);
    expect(preview?.lines.join(" ")).toMatch(/0/); // this journal's own, empty balance

    const response = await postStorage(
      new Request("https://t.test/api/helper/alex/storage", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(sentFor(proposal)),
      }),
      params,
    );
    const body = (await response.json()) as { error?: string };
    expect(body.error).toBe("no_credits");
    expect(await pressRows("buy_room")).toEqual([
      expect.objectContaining({ ok: 0, error: "no_credits" }),
    ]);
  });

  /**
   * B1659 — the double-charge this ticket is about.
   *
   * Same proposal, same minted id, pressed twice — exactly what a network
   * retry or a double-tap sends, since the card's fields (and so its `id`)
   * do not change between the two presses. Without the guard this would
   * insert two `credit_ledger` rows and decrement the balance twice; with it,
   * the second press is a no-op that still answers `ok: true` and says
   * nothing was charged again.
   */
  test("a doubled press charges once, not twice", async () => {
    const { grant } = await import("@/lib/credits");
    await grant("alex", 100);

    const ran = await runTool("alex", "buy_room", {}, say, "2026-05-06", [], "", WEB_CALLER);
    const proposal = ran.proposal!;
    const body = sentFor(proposal);

    const first = await postStorage(
      new Request("https://t.test/api/helper/alex/storage", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      params,
    );
    expect((await first.json()).ok).toBe(true);

    const second = await postStorage(
      new Request("https://t.test/api/helper/alex/storage", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      params,
    );
    const secondBody = (await second.json()) as { ok?: boolean; already?: boolean; message?: string };
    expect(secondBody.ok).toBe(true);
    expect(secondBody.already).toBe(true);
    expect(secondBody.message).toMatch(/already/i);

    const { db } = await getDatabase();
    const rows = await db
      .selectFrom("credit_ledger")
      .selectAll()
      .where("owner_id", "=", "alex")
      .where("reason", "=", "storage")
      .execute();
    expect(rows).toHaveLength(1);

    const { balanceOf } = await import("@/lib/credits");
    expect(await balanceOf("alex")).toBe(50); // 100 granted, 50 spent once
  });
});

describe("keys and revoke_key", () => {
  test("never prints the token, and a revoked key leaves a row and stops being listed", async () => {
    const { issueCode, verifyCode } = await import("@/lib/auth");
    const { code } = await issueCode("alex", OWNER_EMAIL, "agent");
    const minted = await verifyCode("alex", OWNER_EMAIL, code, "agent");
    if (!minted.ok) throw new Error("no token");

    const listed = await runTool("alex", "keys", {}, say, "2026-05-06", [], "", WEB_CALLER);
    expect(JSON.stringify(listed)).not.toContain(minted.token);
    const rows = listed.result as { id: string }[];
    expect(rows.length).toBeGreaterThan(0);

    const revoked = await runTool("alex", "revoke_key", { id: rows[0].id }, say, "2026-05-06", [], "", WEB_CALLER);
    const proposal = revoked.proposal!;
    expect(proposal).toBeTruthy();
    const response = await postKeys(
      new Request("https://t.test/api/helper/alex/keys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(proposal.arguments),
      }),
      params,
    );
    expect(response.status).toBe(200);

    const after = await runTool("alex", "keys", {}, say, "2026-05-06", [], "", WEB_CALLER);
    expect((after.result as unknown[]).length).toBe(0);
  });

  // B1154 — the room's own door onto the same rows: cookie-only, never a
  // token in the answer, same as the tool.
  test("GET lists the same rows the tool sees, and the rendered body never carries the token", async () => {
    const { issueCode, verifyCode } = await import("@/lib/auth");
    const { code } = await issueCode("alex", OWNER_EMAIL, "agent");
    const minted = await verifyCode("alex", OWNER_EMAIL, code, "agent");
    if (!minted.ok) throw new Error("no token");

    const response = await getKeys(new Request("https://t.test/api/helper/alex/keys"), params);
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).not.toContain(minted.token);
    const body = JSON.parse(text) as { keys: { id: string; kind: string }[] };
    expect(body.keys.some((row) => row.kind === "agent")).toBe(true);
  });

  test("an unknown id is refused, and the refusal leaves a row", async () => {
    const response = await postKeys(
      new Request("https://t.test/api/helper/alex/keys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "not-a-real-id" }),
      }),
      params,
    );
    expect(response.status).toBe(404);
    expect(await pressRows("revoke_key")).toEqual([
      expect.objectContaining({ ok: 0, error: "unknown_key" }),
    ]);
  });
});

describe("buy_credits", () => {
  test("hands over the page, and never claims a credit was added", async () => {
    const ran = await runTool("alex", "buy_credits", {}, say, "2026-05-06", [], "", WEB_CALLER);
    const link = ran.blocks.find((b) => b.shape === "link")!;
    expect(link.href).toBe("/alex/studio/account");
    expect(link.text.toLowerCase()).not.toMatch(/added|granted|credited|topped up/);
    expect(link.label.toLowerCase()).not.toMatch(/added|granted|credited|topped up/);
  });
});
