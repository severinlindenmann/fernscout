import { describe, expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import TripSwitcher from "@/components/TripSwitcher";
import LocaleProvider from "@/components/LocaleProvider";
import SiteProvider from "@/components/SiteProvider";
import TripListProvider, { type TripSummary } from "@/components/TripListProvider";
import TripProvider from "@/components/TripProvider";
import { dictionaryFor } from "@/lib/locales";
import type { SiteSummary } from "@/lib/site";
import type { Trip } from "@/lib/types";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: React.ComponentProps<"a">) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/alex" }));

const site: SiteSummary = {
  username: "alex",
  title: "Alex's journal",
  tagline: "t",
  url: "https://example.test",
  startLocation: "X",
  baseCurrency: "CHF",
  locales: ["en"],
  base: "/alex",
  signedIn: false,
  canSignIn: false,
  costsEnabled: true,
};

const trips: TripSummary[] = [
  { id: "short", title: "Japan", start: "2027-01-01", end: "2027-02-01", status: "current" },
  { id: "long", title: "Eighteen days, eleven parks", start: "2025-01-01", end: "2025-02-01", status: "past" },
];

function buttonClasses(title: string): string {
  const trip = { id: "active", ref: "alex/active", username: "alex", title } as unknown as Trip;
  const html = renderToStaticMarkup(
    <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
      <SiteProvider value={site}>
        <TripListProvider trips={trips}>
          <TripProvider trip={trip} isCurrent>
            <TripSwitcher />
          </TripProvider>
        </TripListProvider>
      </SiteProvider>
    </LocaleProvider>,
  );
  const match = /<button[^>]*aria-haspopup="menu"[^>]*class="([^"]*)"/.exec(html);
  if (!match) throw new Error("no trip-switcher button rendered");
  return match[1];
}

/**
 * B286 — two trips with different-length titles made this chip two different
 * widths, which shifted the point where the header's nav wraps to its own
 * line. A fixed width (`sm:w-[14rem]`, not `sm:max-w-[14rem]`) means the
 * chip's contribution to the header's fit calculation is the same regardless
 * of which trip is active — jsdom cannot assert the resulting layout, so this
 * holds the one class list whose reversal (back to a content-driven max-width)
 * brings the variance back, same as B170's own test in this area.
 */
describe("the trip switcher's width", () => {
  test("is fixed on desktop, not driven by the trip's title length", () => {
    const short = buttonClasses("Japan, end to end");
    const long = buttonClasses("Eighteen days, eleven parks");
    for (const classes of [short, long]) {
      expect(classes.split(/\s+/)).not.toContain("sm:max-w-[14rem]");
      expect(classes).toContain("sm:w-[14rem]");
      expect(classes).toContain("sm:justify-between");
    }
  });
});
