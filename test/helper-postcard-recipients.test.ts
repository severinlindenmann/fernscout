import { describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runTool } from "@/lib/helper/tools";

/**
 * B1284 — `propose_postcards` and `postcardCandidates` agree on what a
 * recipient id is.
 *
 * Driven live, the model sent `recipients: "bea-muster"` — the name
 * `postcard_recipients` had just shown it, slugified — instead of the
 * `contactId` the tool's own description asks for. `POST .../postcard`
 * correctly refuses anything not on `postcardCandidates`'s list, so every
 * proposal from that path was `unknown_recipient`, always: the route was
 * right and the caller was wrong.
 *
 * `test/postcard-recipients-route.test.ts` proved the same filter on the
 * *editing* route — drop an id nobody asked with, keep the rest. This is
 * the other caller: the guard belongs in the tool itself, so a bad id never
 * reaches the route to begin with, and so a future change to either side
 * (a new field on `PostcardCandidate`, a new shape from `postcard_recipients`)
 * fails a test here rather than only failing quietly on the live site.
 */

const candidates = vi.hoisted(() =>
  vi.fn(async () => [
    { contactId: "8a185cbe-2fdf-4a10-91a6-7fd3adf51050", name: "Bea Muster", city: "Bern", country: "CH", locale: "en" },
  ]),
);
vi.mock("@/lib/postcard/contacts", () => ({ postcardCandidates: candidates }));
vi.mock("@/lib/capabilities", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/capabilities")>();
  return { ...actual, isEnabled: (name: string) => name === "postcards" || name === "contacts" };
});

const say = (key: string, vars?: Record<string, string>) =>
  vars ? `${key} ${Object.values(vars).join(" ")}` : key;

async function withContent(fn: (dir: string) => Promise<void>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-postcard-"));
  const before = process.env.CONTENT_DIR;
  process.env.CONTENT_DIR = dir;
  try {
    fs.mkdirSync(path.join(dir, "bea", "trips", "bern-weekend-2026", "entries"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "bea", "config.json"),
      JSON.stringify({
        title: "Bea",
        tagline: "t",
        owner: { name: "Mo", nickname: "Mo", email: "mo@example.test" },
        defaultLocale: "de",
        locales: ["en", "de"],
        baseCurrency: "CHF",
      }),
    );
    fs.writeFileSync(
      path.join(dir, "bea", "trips", "bern-weekend-2026", "trip.md"),
      ["---", "id: bern-weekend-2026", "title: Bern Weekend", 'start: "2026-09-05"', 'end: "2026-09-06"', "---", "", "Intro."].join(
        "\n",
      ),
    );
    fs.writeFileSync(
      path.join(dir, "bea", "trips", "bern-weekend-2026", "entries", "2026-09-05-day.md"),
      [
        "---",
        "title: Ein Tag in Bern",
        'date: "2026-09-05"',
        "status: draft",
        "gallery:",
        "  - src: 01.jpg",
        "---",
        "",
        "Worte.",
      ].join("\n"),
    );
    await fn(dir);
  } finally {
    if (before === undefined) delete process.env.CONTENT_DIR;
    else process.env.CONTENT_DIR = before;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe("propose_postcards only ever forwards a contactId", () => {
  test("the id postcard_recipients offered reaches the proposal, and it alone", async () => {
    await withContent(async () => {
      const ran = await runTool(
        "bea",
        "propose_postcards",
        {
          trip: "bern-weekend-2026",
          slug: "2026-09-05-day",
          message: "Grüsse aus Bern!",
          from: "Mo",
          recipients: "8a185cbe-2fdf-4a10-91a6-7fd3adf51050",
        },
        say,
        "2026-09-07",
      );
      expect(ran.ok).toBe(true);
      expect(ran.proposal?.arguments.recipients).toBe("8a185cbe-2fdf-4a10-91a6-7fd3adf51050");
      // The recipient's own locale, filled in rather than left "" — B1284's
      // smaller finding, alongside the id itself.
      expect(ran.proposal?.arguments.locale).toBe("en");
    });
  });

  test("a name slugified from the room's own display, the exact live shape, is refused rather than forwarded", async () => {
    await withContent(async () => {
      const ran = await runTool(
        "bea",
        "propose_postcards",
        {
          trip: "bern-weekend-2026",
          slug: "2026-09-05-day",
          message: "Grüsse aus Bern!",
          from: "Mo",
          recipients: "bea-muster",
        },
        say,
        "2026-09-07",
      );
      // No proposal reaches the model or the screen — B951's shape: a
      // sentence saying why, and no button that would only be refused by the
      // route a step later.
      expect(ran.proposal).toBeUndefined();
      expect(ran.blocks).toEqual([{ shape: "say", text: "agent.tool.postcardsUnknownRecipient" }]);
      expect(ran.result).toMatchObject({ proposed: false, wrote: false });
    });
  });

  test("a mix of a real id and an invented one keeps only the real one", async () => {
    await withContent(async () => {
      const ran = await runTool(
        "bea",
        "propose_postcards",
        {
          trip: "bern-weekend-2026",
          slug: "2026-09-05-day",
          message: "Grüsse aus Bern!",
          from: "Mo",
          recipients: "8a185cbe-2fdf-4a10-91a6-7fd3adf51050,made-up-id",
        },
        say,
        "2026-09-07",
      );
      expect(ran.proposal?.arguments.recipients).toBe("8a185cbe-2fdf-4a10-91a6-7fd3adf51050");
    });
  });
});
