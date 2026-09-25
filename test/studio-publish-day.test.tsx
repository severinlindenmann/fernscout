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

/**
 * B2140 — "Publish a day". The list is drafts only, nothing is written
 * before the confirm, the confirm says "Share this day" (D5, B2192 — it said
 * "Publish this day"), and the done screen names the day.
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

describe("PublishDayFlow", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;
  const ROW: PublishRow = { tripId: "alps", tripTitle: "Alps", slug: "open", title: "Open", date: "2025-01-02", photos: 2, audience: "guest" };

  afterEach(() => {
    vi.unstubAllGlobals();
    act(() => root?.unmount());
    container?.remove();
    root = undefined;
  });

  async function mount(chosen: PublishRow | null, extra: { blank?: string[]; readers?: string[] | null } = {}) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(
        <LocaleProvider dictionary={dictionaryFor("en")} locale="en">
          <StudioBarProvider username={OWNER}>
            <PublishDayFlow username={OWNER} rows={[ROW]} chosen={chosen} missing={false} takeDown={false} canTell={false} {...extra} />
          </StudioBarProvider>
        </LocaleProvider>,
      );
    });
  }

  test("the list links each draft to its own choice, a direct Share…, and preview", async () => {
    await mount(null);
    const row = container!.querySelector("[data-publish-row]")!;
    const links = [...row.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    // The row's title, "Share…" and "Preview" all point at the row — Share
    // and the title open the confirm step directly (B2237).
    expect(links).toEqual([
      "/alex/studio/day/publish?day=open&trip=alps",
      "/alex/studio/day/publish?day=open&trip=alps",
      "/alex/trips/alps/day/open",
    ]);
    const shareLink = [...row.querySelectorAll("a")].find((a) => a.textContent === "Share…");
    expect(shareLink, row.innerHTML).toBeTruthy();
  });

  test("nothing is written before the confirm; the confirm publishes and the done screen names the day", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ status: "published" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await mount(ROW);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(container!.querySelector("[data-audience]")!.getAttribute("data-audience")).toBe("guest");
    const confirm = [...container!.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Share this day");
    expect(confirm, container!.innerHTML.slice(0, 600)).toBeTruthy();
    expect(confirm!.className).toContain("bg-yellow-400");

    await act(async () => confirm!.click());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/web/alex/trips/alps/days/open/publish",
      expect.objectContaining({ method: "POST", body: "{}" }),
    ]);
    expect(container!.querySelector('[role="status"]')!.textContent).toBe("“Open” is shared.");
  });

  test("B2192: the confirm names the blanks and the readers, and the tap sends exactly those blanks", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ status: "published" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await mount(ROW, { blank: ["costs", "time", "transportMode"], readers: ["Hans", "Viki", "Ruth", "Luca"] });

    expect(container!.querySelector("[data-readers]")!.textContent).toBe("By name: Hans, Viki, and 2 others.");
    const dialog = container!.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain("Not filled in: time, costs, and how you travelled. Sharing records them as left blank.");
    // Only what "Change a day" can actually fill is linked there — since
    // B2233 that includes costs and how you travelled.
    const fill = [...dialog.querySelectorAll("a")];
    expect(fill.map((a) => a.getAttribute("href"))).toEqual(Array(3).fill("/alex/studio/day/edit?slug=open"));
    expect(fill.every((a) => a.textContent === "Fill in now")).toBe(true);
    expect(fill.map((a) => a.closest("[data-blank-field]")!.getAttribute("data-blank-field")).sort()).toEqual(["costs", "time", "transportMode"]);
    expect([...dialog.querySelectorAll("button")].map((b) => b.textContent?.trim())).toEqual(["Share this day", "Not yet"]);

    const confirm = [...dialog.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Share this day")!;
    await act(async () => confirm.click());
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/web/alex/trips/alps/days/open/publish",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ declineOpen: ["costs", "time", "transportMode"] }) }),
    ]);
  });

  test("B2192: many blanks read as a few parts; Show all names every field; the tap still declines all of them", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ status: "published" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const all = ["media", "costs", "coordinates", "weather", "time", "timezone", "location", "country", "countryCode", "transportMode", "tags", "translations"];
    await mount({ ...ROW, title: "" }, { blank: all });

    const dialog = container!.querySelector('[role="dialog"]')!;
    expect(dialog.querySelector("[data-blank] > p")!.textContent).toBe(
      "Not filled in: photographs, place, time, costs, how you travelled, and 3 more details. Sharing records them as left blank.",
    );
    const listed = [...dialog.querySelectorAll("details [data-blank-field]")];
    expect(listed.map((li) => li.getAttribute("data-blank-field"))).toEqual(all);
    expect(listed.filter((li) => li.querySelector("a")).map((li) => li.getAttribute("data-blank-field"))).toEqual(["media", "costs", "time", "location", "transportMode", "tags"]);
    // An untitled day is called by its long date, never an ISO string.
    expect(container!.querySelector("h2")!.textContent).toBe("Thursday, 2 January");

    const confirm = [...dialog.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Share this day")!;
    await act(async () => confirm.click());
    expect(JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).toEqual({ declineOpen: all });
  });

  test("B2192: a day nobody else can read says so", async () => {
    await mount(ROW, { readers: [] });
    expect(container!.querySelector("[data-readers]")!.textContent).toContain("Nobody but you can read it yet");
  });
});
