import { describe, expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import LocaleProvider from "@/components/LocaleProvider";
import SearchBox from "@/components/SearchBox";
import SiteProvider from "@/components/SiteProvider";
import { dictionaryFor } from "@/lib/locales";
import type { SiteSummary } from "@/lib/site";

/**
 * B904 — who is offered the agent at all.
 *
 * The button spends a model call, so it belongs to the owner of a journal
 * whose instance has the helper switched on, and to nobody else. It used to
 * ask the route that question with a `fetch`, which put a 401 in the console
 * of every signed-out reader who opened Search; the answer was already in
 * `SiteSummary`, which every page under `/<user>` carries.
 *
 * The route refuses on its own account regardless — this is about what is
 * drawn, not about what is allowed (test/helper-search.test.ts).
 */
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: React.ComponentProps<"a">) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const base: SiteSummary = {
  username: "alex",
  title: "Alex",
  tagline: "t",
  url: "https://example.test",
  startLocation: "X",
  baseCurrency: "CHF",
  locales: ["en"],
  base: "/alex",
  travellerFigures: [],
  signedIn: false,
  hasIdentity: false,
  canSignIn: true,
  analyticsEnabled: true,
  helperEnabled: false,
  isOwner: false,
};

function markup(site: SiteSummary): string {
  return renderToStaticMarkup(
    <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
      <SiteProvider value={site}>
        <SearchBox />
      </SiteProvider>
    </LocaleProvider>,
  );
}

describe("the agent button on the search page", () => {
  test("the owner of a journal with the helper on is offered it", () => {
    expect(markup({ ...base, isOwner: true, helperEnabled: true })).toContain("Ask the agent");
  });

  test("nobody else is — not a reader, and not an owner whose instance has no helper", () => {
    expect(markup(base)).not.toContain("Ask the agent");
    expect(markup({ ...base, isOwner: true })).not.toContain("Ask the agent");
    expect(markup({ ...base, helperEnabled: true })).not.toContain("Ask the agent");
  });
});
