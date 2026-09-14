import { describe, expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import PageHeader from "@/components/PageHeader";
import LocaleProvider from "@/components/LocaleProvider";
import SiteProvider from "@/components/SiteProvider";
import CurrencyProvider from "@/components/CurrencyProvider";
import TripListProvider from "@/components/TripListProvider";
import { dictionaryFor } from "@/lib/locales";
import type { SiteSummary } from "@/lib/site";

/**
 * The way up and out of a journal — B433, rebuilt by B1728.
 *
 * B411 gave a signed-in reader a page listing every journal they may open, and
 * opening one was a one-way trip: the header's title links to the journal's
 * own home, and nothing in the chrome pointed anywhere above it. A reader with
 * three journals had to know to edit the address bar.
 *
 * B433's answer was one arrow to `/`, drawn only for a reader holding an
 * identity. B822 then gave that arrow a second mode — `router.back()`, chosen
 * by a `sessionStorage` flag — and the flag latched on the first soft
 * navigation, so the breadcrumb went one page sideways rather than one level
 * up for the rest of the visit. B1728 replaced both with the chain of
 * ancestors, every crumb a real link, and drew it for everybody: a reader who
 * followed a shared link into one day is the person most stuck without it, and
 * they are exactly the one holding no identity.
 */

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: React.ComponentProps<"a">) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/alex",
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));

const base: SiteSummary = {
  username: "alex",
  title: "Journal of Five",
  name: "Fernscout",
  tagline: "Five journeys",
  url: "https://example.test",
  startLocation: "X",
  baseCurrency: "CHF",
  locales: ["en"],
  base: "/alex",
  travellerFigures: [],
  signedIn: false,
  hasIdentity: false,
  canSignIn: false,
  analyticsEnabled: true,
  helperEnabled: false,
  isOwner: false,
};

function markup(site: SiteSummary, locale = "en"): string {
  return renderToStaticMarkup(
    <LocaleProvider locale={locale} dictionary={dictionaryFor(locale)}>
      <SiteProvider value={site}>
        <CurrencyProvider options={{ base: "CHF", currencies: ["CHF"], rates: { CHF: 1 } }}>
          <TripListProvider trips={[]}>
            <PageHeader />
          </TripListProvider>
        </CurrencyProvider>
      </SiteProvider>
    </LocaleProvider>,
  );
}

/** Every `<a>` in the rendered header, as href plus its visible text. */
function links(html: string): { href: string; text: string }[] {
  return [...html.matchAll(/<a href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)].map((m) => ({
    href: m[1],
    text: m[2].replace(/<[^>]*>/g, "").trim(),
  }));
}

describe("the way up, out of a journal", () => {
  test("a reader holding an identity is offered their journals by name", () => {
    const html = markup({ ...base, hasIdentity: true });
    expect(links(html).some((l) => l.href === "/" && l.text === "Your journals")).toBe(true);
  });

  /**
   * The crumb is drawn for everyone; only its *word* turns on `hasIdentity`,
   * and the two genuinely come apart from `signedIn`. Every session issued
   * before B410, and every one a journal's own `/<user>/me` form issues, is a
   * guest session on this journal with no identity behind it — promising those
   * readers "your journals" and landing them on the public pitch is the bug
   * `hasIdentity` exists for.
   */
  test("a guest session on this journal alone is shown the instance, not 'your journals'", () => {
    const html = markup({ ...base, signedIn: true, hasIdentity: false });
    expect(html).not.toContain("Your journals");
    expect(links(html).some((l) => l.href === "/" && l.text === "Fernscout")).toBe(true);
  });

  test("a stranger still gets a way out, named for where it goes", () => {
    const html = markup(base);
    expect(html).not.toContain("Your journals");
    expect(links(html).some((l) => l.href === "/" && l.text === "Fernscout")).toBe(true);
  });

  /**
   * The journal is its trip list, not `/<user>` — that address is the current
   * trip's story (`TripProvider`), so a crumb pointing there would have said
   * "journal" and gone to a trip.
   *
   * Named for the page rather than for the journal, and that is the second
   * half of the same point: the journal's title is already the heading right
   * below the trail and again beside the phone row's arrow, so a crumb
   * carrying it printed one word twice on two controls that go to different
   * places.
   */
  test("the journal's own crumb is its trip list, named for that page", () => {
    const html = markup(base);
    expect(links(html).some((l) => l.href === "/alex/trips" && l.text === "Trips")).toBe(true);
    expect(links(html).some((l) => l.href === "/alex/trips" && l.text === "Journal of Five")).toBe(
      false,
    );
  });

  /**
   * Not a mobile affordance with a desktop equivalent elsewhere: a reader is
   * equally stuck on either. Two renderings, because one line cannot hold both
   * the full chain and the journal's title on a phone — the trail from `sm`
   * up, the nearest crumb alone below it. Both must exist.
   */
  test("a way up renders at both widths", () => {
    const html = markup(base);
    const up = links(html).filter((l) => l.href === "/alex/trips");
    expect(up.length).toBeGreaterThanOrEqual(2);
    // And the phone one carries its word. An unlabelled arrow there is what
    // made the old control unreadable — the label was the only thing that
    // ever said which of its two meanings was in force, and that row never
    // drew it.
    expect(up.every((l) => l.text.length > 0)).toBe(true);
  });

  test("it speaks the reader's language", () => {
    expect(markup({ ...base, hasIdentity: true }, "de")).toContain("Deine Reisetagebücher");
  });

  /**
   * The nav row is measured twice in PageHeader's own comments and was the
   * cause of B170 and B212; seven controls already wrap onto their own line on
   * a phone. This belongs to the title box, above the journal's name.
   */
  test("it sits in the title box rather than in the crowded nav row", () => {
    // The `sm`-and-up half of the header, which is the one with both a trail
    // and a title to order against each other.
    const wide = markup({ ...base, hasIdentity: true });
    const block = wide.slice(wide.indexOf("max-w-7xl"));
    expect(block.indexOf("Your journals")).toBeLessThan(block.indexOf("Journal of Five"));
  });

  /**
   * The whole point of the change: there is one destination per control and
   * the browser can show it before you commit. A `<button>` in this box would
   * mean history navigation had come back.
   */
  test("every way up is a link with an address, never a button", () => {
    const html = markup(base);
    const box = html.slice(0, html.indexOf("Journal of Five"));
    expect(box).not.toContain("<button");
  });
});
