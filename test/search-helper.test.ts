import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

/**
 * B903 — the rows that only exist where a capability is on.
 *
 * `test/search-reader.test.ts` proves the other half over a journal with the
 * helper switched off: a row whose capability is off is in nobody's index,
 * the owner's included. This file switches it on and asks the question that
 * one cannot — whether the row, now that it exists, still belongs to the
 * owner alone.
 *
 * `isEnabled` is mocked rather than satisfied. The real one wants an
 * `ANTHROPIC_API_KEY` and a database (lib/capabilities.ts), and neither says
 * anything about the gate under test; what matters here is what `lib/search.ts`
 * does with a "yes".
 */
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));

const who = vi.hoisted(() => ({ owner: false }));

/** Who is asking, without a cookie, a session row or a database — the gate
 *  under test is what `lib/search.ts` does with the answer, not how the
 *  answer is reached. */
vi.mock("@/lib/contacts/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/contacts/session")>();
  return { ...actual, isOwner: async () => who.owner };
});

vi.mock("@/lib/capabilities", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/capabilities")>();
  return { ...actual, isEnabled: () => true };
});

const OWNER = "quinn";
const OWNER_EMAIL = "quinn@example.test";
let dir = "";

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-search-helper-"));
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "R", url: "https://example.test", defaultUser: OWNER },
      users: { reserved: [] },
    }),
  );
  fs.mkdirSync(path.join(dir, OWNER, "trips", "open-2026", "entries"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, OWNER, "config.json"),
    JSON.stringify({
      title: "Quinn's Journal",
      owner: { name: "Quinn R", nickname: "Quinn", email: OWNER_EMAIL },
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
    }),
  );
  fs.writeFileSync(
    path.join(dir, OWNER, "trips", "open-2026", "trip.md"),
    [
      "---",
      "id: open-2026",
      'title: "An Open Trip"',
      'start: "2026-08-24"',
      'end: "2026-08-26"',
      "status: past",
      "visibility: public",
      "---",
      "",
      "An open trip.",
    ].join("\n"),
  );
  process.env.CONTENT_DIR = dir;
});

afterAll(() => {
  delete process.env.CONTENT_DIR;
  fs.rmSync(dir, { recursive: true, force: true });
});

async function jsonFor(reader: "owner" | "stranger"): Promise<string> {
  who.owner = reader === "owner";
  const { buildSearchIndexJsonForReader } = await import("@/lib/search");
  return (await buildSearchIndexJsonForReader(OWNER))!;
}

describe("rows that need a capability", () => {
  test("the helper and its inbox are the owner's, and are addressed outside the journal", async () => {
    const owner = await jsonFor("owner");
    expect(owner).toContain(`/agent/${OWNER}"`);
    expect(owner).toContain(`/agent/${OWNER}/inbox`);
  });

  test("nobody else finds them, and the anonymous index never carries them", async () => {
    expect(await jsonFor("stranger")).not.toContain(`/agent/${OWNER}`);
    const { buildSearchIndexJson } = await import("@/lib/search");
    expect(buildSearchIndexJson(OWNER)!).not.toContain(`/agent/${OWNER}`);
  });

  test("the photobook is the owner's too, on the trip's own base", async () => {
    // One trip, so it is the current one and its pages hang off the journal's
    // base rather than `/trips/<id>` — `tripBaseFor`, unchanged since B823.
    const owner = await jsonFor("owner");
    expect(owner).toContain(`/${OWNER}/photobook`);
    expect(await jsonFor("stranger")).not.toContain("/photobook");
  });

  test("costs and weather stay out while the trip has neither", async () => {
    // The capability is on for everything here, so what keeps these two out is
    // the second half of the gate: `analyticsCardsFor`, which asks whether
    // this trip has anything to add up.
    const owner = await jsonFor("owner");
    expect(owner).not.toContain("/costs");
    expect(owner).not.toContain("/weather");
  });
});
