import { describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import PhotobookPageContent from "@/app/[user]/(trip)/photobook/PhotobookPageContent";
import LocaleProvider from "@/components/LocaleProvider";
import SiteProvider from "@/components/SiteProvider";
import CurrencyProvider from "@/components/CurrencyProvider";
import TripListProvider from "@/components/TripListProvider";
import { dictionaryFor } from "@/lib/locales";
import { PHOTOBOOK_OUTCOME_STATES, type PhotobookOutcome } from "@/lib/photobook/orders";
import type { SiteSummary } from "@/lib/site";

/**
 * B484 — two narrow gaps in the order-outcome page.
 *
 * 1. `OUTCOME_MESSAGE` in `PhotobookPageContent.tsx` used to be typed
 *    `Record<string, TranslationKey>`, so it could fall out of step with the
 *    states `order/route.ts` actually sends without the compiler noticing —
 *    exactly the drift `test/locales.test.ts`'s B529 case checks for
 *    `TranslationKey` itself. It is now an exact `Record` over
 *    `PhotobookOutcomeState` minus `"done"`, so `tsc` refuses the file if a
 *    state is added there without its message here, or if a stale entry (the
 *    now-unreachable `"refund_failed"`, from before B509) is left behind.
 *    This test parses the source the same way B529 does, so the check still
 *    runs under `--quick`, which skips the typecheck.
 *
 * 2. The success panel could render with no download links at all — B484's
 *    other half — when `markPrinted`'s payload carries no `files` because the
 *    row had already left `submitted`. The receipt mail still has them
 *    (`sendPhotobookReceipt` runs off the real build result, not this row),
 *    so the panel now says that instead of showing nothing.
 */

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: React.ComponentProps<"a">) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/alex/trips/asia-2026/photobook",
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));

const site: SiteSummary = {
  username: "alex",
  title: "Fernscout Demo",
  tagline: "Five journeys, to show what this thing does",
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
};

function markup(outcome: PhotobookOutcome | null): string {
  return renderToStaticMarkup(
    <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
      <SiteProvider value={site}>
        <CurrencyProvider options={{ base: "CHF", currencies: ["CHF"], rates: { CHF: 1 } }}>
          <TripListProvider trips={[]}>
            <PhotobookPageContent
              entry={{ username: "alex", trip: "asia-2026" }}
              tripRef="alex/asia-2026"
              tripTitle="Asia 2026"
              media={[]}
              days={[]}
              balance={100}
              locales={["en"]}
              outcome={outcome}
            />
          </TripListProvider>
        </CurrencyProvider>
      </SiteProvider>
    </LocaleProvider>,
  );
}

describe("OUTCOME_MESSAGE covers every non-'done' state — B484", () => {
  test("its keys are exactly PHOTOBOOK_OUTCOME_STATES minus 'done'", () => {
    const source = fs.readFileSync(
      path.join(
        import.meta.dirname,
        "..",
        "app",
        "[user]",
        "(trip)",
        "photobook",
        "PhotobookPageContent.tsx",
      ),
      "utf8",
    );
    const start = source.indexOf("const OUTCOME_MESSAGE");
    expect(start).toBeGreaterThan(-1);
    const block = source.slice(start, source.indexOf("\n};", start));
    const declared = [...block.matchAll(/^\s*([a-z_]+):\s*"photobook\./gm)].map((m) => m[1]);

    const expected = PHOTOBOOK_OUTCOME_STATES.filter((s) => s !== "done");
    expect(declared.sort()).toEqual([...expected].sort());
  });
});

describe("the result panel after a successful order — B484", () => {
  test("a stored file list still shows its download links", () => {
    const html = markup({ state: "done", orderId: "order-1", files: ["book-interior.pdf"] });
    expect(html).toContain("book-interior.pdf");
    expect(html).not.toContain(dictionaryFor("en")["photobook.done.filesInMail"]);
  });

  test("an empty file list tells the owner where the links are, rather than showing nothing", () => {
    const html = markup({ state: "done", orderId: "order-1", files: [] });
    expect(html).not.toContain("<ul");
    expect(html).toContain(dictionaryFor("en")["photobook.done.filesInMail"]);
  });
});
