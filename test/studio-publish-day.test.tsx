// @vitest-environment jsdom
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import LocaleProvider from "@/components/LocaleProvider";
import StudioBarProvider from "@/components/studio/StudioBar";
import PublishDayFlow from "@/components/studio/day/PublishDayFlow";
import { clearConfigCache } from "@/lib/config";
import { dictionaryFor } from "@/lib/locales";
import { blankFieldsOf, daysToPublish, readersOf, type PublishRow } from "@/lib/studio/publishDay";
import { clearUserCache } from "@/lib/users";
import { writeDayFixture, writeTripFixture } from "./fixtures/content";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }));

/**
 * B2140 — "Publish a day". The list is drafts only, nothing is written
 * before the confirm, the confirm says "Publish this day" (B1384 decision 8
 * — it said "Share this day"), and the done screen names the day.
 *
 * B2192 — the confirm names the blanks the tap records as left blank, and the
 * readers by name.
 */

const OWNER = "alex";

describe("daysToPublish", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-publish-day-"));
    process.env.CONTENT_DIR = dir;
    fs.writeFileSync(path.join(dir, "config.json"), JSON.stringify({ site: { name: "T", url: "https://t.test" }, features: {} }));
    fs.mkdirSync(path.join(dir, OWNER), { recursive: true });
    fs.writeFileSync(
      path.join(dir, OWNER, "config.json"),
      JSON.stringify({ title: "Alex", tagline: "t", owner: { name: "A B", nickname: "A", email: "alex@example.test" }, locales: ["en"], defaultLocale: "en" }),
    );
    clearConfigCache();
    clearUserCache();
  });
  afterEach(() => {
    delete process.env.CONTENT_DIR;
    clearConfigCache();
    clearUserCache();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("lists only drafts, and says who a day would reach", () => {
    writeTripFixture(OWNER, { id: "alps", title: "Alps", start: "2025-01-01", end: "2025-01-05", visibility: "public", listed: true });
    writeDayFixture(dir, OWNER, "alps", { slug: "up", title: "Up", date: "2025-01-01", status: "published" });
    writeDayFixture(dir, OWNER, "alps", { slug: "open", title: "Open", date: "2025-01-02", status: "draft" });
    writeDayFixture(dir, OWNER, "alps", { slug: "narrow", title: "Narrow", date: "2025-01-03", status: "draft", visibility: "guest" });

    const drafts = daysToPublish(OWNER, "draft");
    expect(drafts.map((r) => r.slug)).toEqual(["narrow", "open"]);
    expect(drafts.find((r) => r.slug === "open")!.audience).toBe("public");
    // A day's own visibility narrows the trip's.
    expect(drafts.find((r) => r.slug === "narrow")!.audience).toBe("guest");

    expect(daysToPublish(OWNER, "published").map((r) => r.slug)).toEqual(["up"]);
  });

  test("B2192: the blanks are exactly what publishing would refuse on, and a private day reaches nobody a bare people: entry names (D3, B2297)", async () => {
    writeTripFixture(OWNER, {
      id: "alps",
      title: "Alps",
      start: "2025-01-01",
      end: "2025-01-05",
      visibility: "private",
      people: [
        { name: "A B", email: "alex@example.test" },
        { name: "Hans Muster", nickname: "Hans", email: "hans@example.test" },
        { name: "Viki Kovács", email: "viki@example.test" },
      ],
    });
    writeDayFixture(dir, OWNER, "alps", {
      slug: "open",
      title: "Open",
      date: "2025-01-02",
      status: "draft",
      location: "Somewhere",
      country: "Nowhere",
      declined: {
        media: "none on this test day",
        coordinates: "no position recorded",
        weather: "not recorded for this test day",
        time: "no time of day recorded",
        timezone: "not known for this test day",
        countryCode: "not recorded for this test day",
        visibility: "shown to everyone the trip lets in",
      },
    });
    const row = daysToPublish(OWNER, "draft")[0];
    expect(blankFieldsOf(OWNER, row).sort()).toEqual(["costs", "tags", "transportMode"]);
    // Hans and Viki are only named in `people:`, never granted a place —
    // since D3 (B2297) that reaches nobody, this file runs no database at
    // all (no `trip_people` to grant a place in anyway), and the owner is
    // left out regardless. `test/day-mail.test.ts` covers the granted case
    // with a real database.
    expect(await readersOf(OWNER, row)).toEqual([]);
    expect(await readersOf(OWNER, { ...row, audience: "public" })).toBeNull();
  });
});

describe("PublishDayFlow — B2677, narrowed to the drafts list and the take-down confirm", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;
  const ROW: PublishRow = { tripId: "alps", tripTitle: "Alps", slug: "open", title: "Open", date: "2025-01-02", photos: 2, audience: "guest" };

  afterEach(() => {
    vi.unstubAllGlobals();
    act(() => root?.unmount());
    container?.remove();
    root = undefined;
  });

  async function mount(chosen: PublishRow | null, takeDown: boolean) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(
        <LocaleProvider dictionary={dictionaryFor("en")} locale="en">
          <StudioBarProvider username={OWNER}>
            <PublishDayFlow username={OWNER} rows={[ROW]} chosen={chosen} missing={false} takeDown={takeDown} />
          </StudioBarProvider>
        </LocaleProvider>,
      );
    });
  }

  test("a draft's own 'Publish…' opens Preview, not this page's own confirm", async () => {
    await mount(null, false);
    const row = container!.querySelector("[data-publish-row]")!;
    const links = [...row.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(links).toEqual(["/@alex/studio/day/preview?trip=alps&date=2025-01-02", "/@alex/studio/day/preview?trip=alps&date=2025-01-02", "/@alex/trips/alps/day/open"]);
    const shareLink = [...row.querySelectorAll("a")].find((a) => a.textContent === "Publish…");
    expect(shareLink, row.innerHTML).toBeTruthy();
  });

  test("a published row's own link goes to this page's own take-down confirm", async () => {
    await mount(null, true);
    const row = container!.querySelector("[data-publish-row]")!;
    const links = [...row.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(links[0]).toBe("/@alex/studio/day/publish?day=open&trip=alps&list=published");
  });

  test("nothing is written before the confirm; the confirm takes the day down and the done screen names it", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await mount(ROW, true);

    expect(fetchMock).not.toHaveBeenCalled();
    const confirm = [...container!.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Take it off the site");
    expect(confirm, container!.innerHTML.slice(0, 600)).toBeTruthy();

    await act(async () => confirm!.click());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((fetchMock.mock.calls as unknown as [string][])[0][0]).toBe("/api/web/alex/trips/alps/days/open/unpublish");
    expect(container!.querySelector('[role="status"]')!.textContent).toBe("“Open” is off the site.");
  });
});
