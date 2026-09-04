import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import TripsIndexContent, { type TripCardData } from "@/app/[user]/trips/TripsIndexContent";
import LocaleProvider from "@/components/LocaleProvider";
import SiteProvider from "@/components/SiteProvider";
import CurrencyProvider from "@/components/CurrencyProvider";
import TripListProvider from "@/components/TripListProvider";
import { dictionaryFor } from "@/lib/locales";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import type { SiteSummary } from "@/lib/site";
import type { MalformedTrip } from "@/lib/trips";

/**
 * The owner's half of B83: what the trip list says when a `trip.md` will not
 * read, and — the other half of every assertion here — what everyone else is
 * told, which is nothing.
 *
 * `test/malformed-trips.test.ts` covers the parser. This covers the page: that
 * the reason arrives in the journal's language rather than the parser's
 * English, that a journal holding nothing but a broken trip does not also
 * render the promise-over-four-zeroes B76 removed, and that a stranger's
 * payload does not contain the folder name at all.
 */

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/alex/trips",
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));

const site = {
  username: "alex",
  title: "Alex's journal",
  tagline: "t",
  url: "https://example.test",
  startLocation: "X",
  baseCurrency: "CHF",
  locales: ["en"],
  base: "/alex",
} as unknown as SiteSummary;

const aTrip: TripCardData = {
  id: "asia",
  title: "Asia",
  accent: "sky",
  status: "past",
  start: "2026-01-01",
  end: "2026-01-05",
  tripDays: 5,
  countries: 2,
  totalMedia: 40,
};

const WRECKED: MalformedTrip = {
  folder: "japan-2027",
  reason: "missing-fields",
  problem: "it needs a title and ISO start and end dates (YYYY-MM-DD); start, end are missing",
};

function render(
  over: { malformed?: MalformedTrip[]; trips?: TripCardData[]; locale?: string } = {},
) {
  const locale = over.locale ?? "en";
  return renderToStaticMarkup(
    <LocaleProvider locale={locale} dictionary={dictionaryFor(locale)}>
      <SiteProvider value={site}>
        <CurrencyProvider options={{ base: "CHF", currencies: ["CHF"], rates: { CHF: 1 } }}>
          <TripListProvider trips={[]}>
            <TripsIndexContent
              trips={over.trips ?? []}
              routes={[]}
              lifetime={{ countries: 0, days: 0, photos: 0, trips: 0 }}
              empty={null}
              malformed={over.malformed ?? []}
            />
          </TripListProvider>
        </CurrencyProvider>
      </SiteProvider>
    </LocaleProvider>,
  );
}

describe("the notice", () => {
  test("names the file, so the owner has something to open", () => {
    const html = render({ malformed: [WRECKED] });
    expect(html).toContain("data-malformed-trips");
    expect(html).toContain("japan-2027/trip.md");
  });

  /**
   * The point of the reason code. Before it, the heading was translated and
   * the sentence under it — the half that says what to actually fix — was
   * English on every journal in every language.
   */
  test("says what is wrong in the journal's language, not only in English", () => {
    expect(render({ malformed: [WRECKED] })).toContain(
      "it needs a title and start and end dates written as 2027-04-01",
    );
    expect(render({ malformed: [WRECKED], locale: "de" })).toContain(
      "es fehlen der Titel oder die Daten start und end",
    );
    expect(render({ malformed: [WRECKED], locale: "hu" })).toContain(
      "hiányzik a cím vagy a start",
    );
  });

  test("has a line for every way the parser can refuse a file", () => {
    const reasons: MalformedTrip["reason"][] = [
      "no-file",
      "unparseable",
      "missing-id",
      "id-mismatch",
      "invalid-id",
      "missing-fields",
    ];
    const html = render({
      malformed: reasons.map((reason, i) => ({ folder: `f${i}`, reason, problem: "p" })),
    });
    // Every one renders as copy, not as a raw key that slipped the table.
    expect(html).not.toContain("trips.malformed");
    for (let i = 0; i < reasons.length; i++) expect(html).toContain(`f${i}/trip.md`);
  });

  /** `role="note"`, like the draft and test banners. An assertive live region
   * interrupts a screen reader to announce something that was already on the
   * page when it loaded. */
  test("is a note rather than an alert", () => {
    const html = render({ malformed: [WRECKED] });
    expect(html).toContain('role="note"');
    expect(html).not.toContain('role="alert"');
  });

  test("is absent when every trip reads", () => {
    expect(render({ trips: [aTrip] })).not.toContain("data-malformed-trips");
  });
});

/**
 * The seam with B76, which removed the subtitle and the four zero tiles from an
 * empty journal because they promised a record the page did not have. A journal
 * holding nothing but a broken trip has exactly as little to show, and the
 * notice above has already explained why.
 */
describe("a journal with nothing else in it", () => {
  test("does not render four zeroes under a promise", () => {
    const html = render({ malformed: [WRECKED] });
    expect(html).not.toContain("Everywhere we");
    expect(html).not.toMatch(/>days on the road/);
  });

  test("nor the empty state, because the journal is not empty", () => {
    expect(render({ malformed: [WRECKED] })).not.toContain("No trips yet");
  });

  test("but a journal with readable trips beside it still shows them", () => {
    const html = render({ malformed: [WRECKED], trips: [aTrip] });
    expect(html).toContain("data-malformed-trips");
    expect(html).toContain("Asia");
    expect(html).toContain("Everywhere we");
  });
});

/**
 * Who is handed the folder names, decided on the server.
 *
 * Asserted on the page's props rather than its markup: what matters is that a
 * stranger's payload does not *contain* the list, which is a stronger claim
 * than "does not display it".
 */
describe("the page decides who sees it", () => {
  let dir: string;
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-malformed-page-"));
    process.env.CONTENT_DIR = dir;
    fs.writeFileSync(
      path.join(dir, "config.json"),
      JSON.stringify({
        site: { name: "T", url: "https://t.test", defaultUser: "alex" },
        features: {},
      }),
    );
    fs.mkdirSync(path.join(dir, "alex", "trips", "japan-2027"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "alex", "config.json"),
      JSON.stringify({ title: "Alex", owner: { name: "A B", nickname: "A", email: "a@t.test" } }),
    );
    // The journal's only trip, and it will not parse.
    fs.writeFileSync(
      path.join(dir, "alex", "trips", "japan-2027", "trip.md"),
      ["---", "id: japan-2027", "---", "", "Body."].join("\n"),
    );
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    clearConfigCache();
    clearUserCache();
  });

  afterEach(() => {
    delete process.env.CONTENT_DIR;
    warn.mockRestore();
    clearConfigCache();
    clearUserCache();
    fs.rmSync(dir, { recursive: true, force: true });
    vi.resetModules();
  });

  /** The page, rendered for somebody who is or is not the owner. */
  async function pageProps(owner: boolean) {
    vi.resetModules();
    vi.doMock("@/lib/contacts/session", () => ({ isOwner: async () => owner }));
    vi.doMock("@/lib/tripGate", () => ({
      listableTrips: async (t: unknown) => t,
      signedInAs: async () => null,
    }));
    const { default: TripsPage } = await import("@/app/[user]/trips/page");
    const element = (await TripsPage({
      params: Promise.resolve({ user: "alex" }),
      searchParams: Promise.resolve({}),
    } as never)) as { props: Record<string, unknown> };
    return element.props;
  }

  test("the owner is handed the folder and the reason", async () => {
    const props = (await pageProps(true)) as { malformed: MalformedTrip[] };
    expect(props.malformed).toHaveLength(1);
    expect(props.malformed[0]).toMatchObject({
      folder: "japan-2027",
      reason: "missing-fields",
    });
  });

  /** The reason is translated in the browser, so the English sentence has no
   * reader there — sending it would duplicate every message in the payload. */
  test("but not the English sentence, which the page does not render", async () => {
    const props = await pageProps(true);
    expect(props.malformed).toEqual([{ folder: "japan-2027", reason: "missing-fields" }]);
    expect(JSON.stringify(props)).not.toContain("ISO start and end dates");
  });

  test("and is not told the journal is empty, because it is not", async () => {
    const props = (await pageProps(true)) as { empty: unknown };
    expect(props.empty).toBeNull();
  });

  test("a stranger's page does not contain the folder name at all", async () => {
    const props = (await pageProps(false)) as { malformed: MalformedTrip[]; empty: unknown };
    expect(props.malformed).toEqual([]);
    expect(JSON.stringify(props)).not.toContain("japan-2027");
    // To them the journal really is empty: there is no trip they could read.
    // Byte-identical to a genuinely empty journal — B264 — which is why this
    // is `signedIn: false` rather than any hint that a trip exists at all.
    expect(props.empty).toEqual({ owner: false, signedIn: false });
  });
});
