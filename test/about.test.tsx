import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { getAbout } from "@/lib/about";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";

/**
 * B10 — a journal never said who was writing it. `getAbout` is the reader
 * for the new `content/<user>/about.md`, modelled on `readPlanFile` and
 * `readCostsFile`: absent file, malformed frontmatter and a draft all read
 * back as "nothing to show" unless the caller asked for a preview.
 */

vi.mock("next/navigation", () => ({
  usePathname: () => "/a/about",
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));

let dir: string;

function write(rel: string, contents: string) {
  const file = path.join(dir, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-about-"));
  process.env.CONTENT_DIR = dir;
  write(
    "config.json",
    JSON.stringify({ site: { name: "T", url: "https://example.test" }, features: {} }),
  );
  write(
    "ab/config.json",
    JSON.stringify({
      title: "A's journal",
      tagline: "t",
      owner: { name: "Pat Author", nickname: "Pat", email: "pat@example.test" },
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
      features: {},
    }),
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

describe("getAbout", () => {
  test("null when there is no about.md at all", () => {
    expect(getAbout("ab")).toBeNull();
  });

  test("the published body, once written", () => {
    write("ab/about.md", "---\nstatus: published\n---\n\nWe're Pat and Alex.\n");
    expect(getAbout("ab")).toEqual({ markdown: "We're Pat and Alex." });
  });

  test("a file with no status is published by default, same as an entry", () => {
    write("ab/about.md", "Nothing declared, published anyway.");
    expect(getAbout("ab")?.markdown).toBe("Nothing declared, published anyway.");
  });

  test("a draft is absent for the ordinary reader", () => {
    write("ab/about.md", "---\nstatus: draft\n---\n\nStill being written.\n");
    expect(getAbout("ab")).toBeNull();
  });

  test("a draft is returned when the caller previews it", () => {
    write("ab/about.md", "---\nstatus: draft\n---\n\nStill being written.\n");
    expect(getAbout("ab", { includeDrafts: true })).toEqual({
      markdown: "Still being written.",
    });
  });

  test("malformed frontmatter degrades to absent rather than throwing", () => {
    write("ab/about.md", "---\nstatus: [\n---\n\nBody.\n");
    expect(() => getAbout("ab")).not.toThrow();
    expect(getAbout("ab")).toBeNull();
  });

  test("an empty body reads the same as no file", () => {
    write("ab/about.md", "---\nstatus: published\n---\n\n");
    expect(getAbout("ab")).toBeNull();
  });
});

describe("AboutPageContent", () => {
  test("names the owner and never prints their address", async () => {
    const { default: AboutPageContent } = await import(
      "@/app/[user]/about/AboutPageContent"
    );
    const { default: LocaleProvider } = await import("@/components/LocaleProvider");
    const { default: SiteProvider } = await import("@/components/SiteProvider");
    const { default: TripListProvider } = await import("@/components/TripListProvider");
    const { dictionaryFor } = await import("@/lib/locales");
    const { default: CurrencyProvider } = await import("@/components/CurrencyProvider");

    const site = {
      username: "ab",
      title: "A's journal",
      tagline: "t",
      url: "https://example.test",
      startLocation: "X",
      baseCurrency: "CHF",
      locales: ["en"],
      base: "/a",
      canSignIn: false,
      signedIn: false,
    } as unknown as import("@/lib/site").SiteSummary;

    const html = renderToStaticMarkup(
      <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
        <SiteProvider value={site}>
          <CurrencyProvider options={{ base: "CHF", currencies: ["CHF"], rates: { CHF: 1 } }}>
            <TripListProvider trips={[]}>
              <AboutPageContent
                title="About this journal"
                ownerName="Pat Author"
                markdown="We're Pat and Alex, on the road since 2024."
              />
            </TripListProvider>
          </CurrencyProvider>
        </SiteProvider>
      </LocaleProvider>,
    );

    expect(html).toContain("Pat Author");
    expect(html).toContain("We&#x27;re Pat and Alex");
    // The one thing this page must never do — the owner's address sits right
    // beside the name `page.tsx` read from config, and this asserts it never
    // reaches the HTML: not because nothing is passed for it (it never is),
    // but because the rendered markup itself carries no address at all.
    expect(html).not.toContain("pat@example.test");
    expect(html).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  });
});

describe("the trip overview names travellers visibly", () => {
  test("the byline is in the rendered DOM, not only in the StructuredData script", async () => {
    const { default: TripStory } = await import("@/app/TripStory");
    const { default: TripProvider } = await import("@/components/TripProvider");
    const { default: LocaleProvider } = await import("@/components/LocaleProvider");
    const { default: SiteProvider } = await import("@/components/SiteProvider");
    const { default: TripListProvider } = await import("@/components/TripListProvider");
    const { default: CurrencyProvider } = await import("@/components/CurrencyProvider");
    const { dictionaryFor } = await import("@/lib/locales");
    const { currencyOptions } = await import("@/lib/rates");
    const { createTrip } = await import("@/lib/tripWrite");
    const { createDraft, publishDraft } = await import("@/lib/api/entries");
    const { buildStoryProps } = await import("@/lib/tripView");
    const { getTrips } = await import("@/lib/trips");
    const { getUser } = await import("@/lib/users");
    const { siteSummary, travellerNamesOf } = await import("@/lib/site");

    const ref = "ab/summer-2026";
    const made = createTrip("ab", {
      id: "summer-2026",
      title: "Summer",
      start: "2026-06-01",
      end: "2026-06-10",
      status: "current",
      visibility: "public",
      // A second traveller with an address — the field the byline must
      // never print, per lib/tripPeople.ts.
      people: [{ name: "Alex Second", email: "alex@example.test" }],
    });
    if (!made.ok) throw new Error(`could not create the trip: ${made.message}`);

    const draft = createDraft(ref, {
      title: "Day one",
      date: "2026-06-02",
      location: "Zurich",
      country: "Switzerland",
      content: "First day.",
    });
    if (!draft.ok) throw new Error(`could not write the draft: ${draft.error}`);
    const published = publishDraft(ref, draft.slug);
    if (!published.ok) throw new Error(`could not publish: ${published.error}`);

    const props = buildStoryProps(ref);
    const site = siteSummary("ab", true);
    if (!site) throw new Error("no site");
    const userConfig = getUser("ab");
    if (!userConfig) throw new Error("no user");
    const trips = getTrips("ab").map((t) => ({
      id: t.id,
      ref: t.ref,
      username: t.username,
      title: t.title,
      start: t.start,
      end: t.end,
      status: t.status,
      translations: t.translations,
    }));

    const html = renderToStaticMarkup(
      <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
        <SiteProvider value={site}>
          <TripListProvider trips={trips}>
            <CurrencyProvider options={currencyOptions("ab")}>
              <TripProvider trip={props.trip} isCurrent>
                <TripStory
                  index={props.index}
                  days={props.days}
                  windowStart={props.windowStart}
                  initialDate={props.initialDate}
                  stats={props.stats}
                  travellerNames={travellerNamesOf(userConfig, props.trip)}
                />
              </TripProvider>
            </CurrencyProvider>
          </TripListProvider>
        </SiteProvider>
      </LocaleProvider>,
    );

    // Strip every <script> block — that is where StructuredData's JSON-LD
    // lives — and confirm the names are still there in what is left.
    const withoutScripts = html.replace(/<script[\s\S]*?<\/script>/g, "");
    expect(withoutScripts).toContain("Pat");
    expect(withoutScripts).toContain("Alex Second");
    // The email that named them stays out of both halves.
    expect(html).not.toContain("alex@example.test");
  });
});
