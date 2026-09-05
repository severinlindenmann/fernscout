import { describe, expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import LocaleProvider from "@/components/LocaleProvider";
import { YourDevices, YourJournals, type HomeDevice, type HomeJournal } from "@/components/HomeJournals";
import { dictionaryFor } from "@/lib/locales";

/**
 * What the signed-in root page says — B411.
 *
 * The panel is client-rendered from `/api/v1/me/home`, so `test/home.test.ts`
 * covers what may appear in it and this covers what it then says about it.
 * The thing worth pinning is the labelling: this list deliberately mixes
 * journals somebody owns with journals somebody else let them into, and if the
 * badge is wrong the page is actively misleading about whose journal it is.
 */

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

function render(node: React.ReactNode) {
  return renderToStaticMarkup(
    <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
      {node}
    </LocaleProvider>,
  );
}

function journal(over: Partial<HomeJournal> = {}): HomeJournal {
  return {
    username: "ana",
    title: "Two Backpacks",
    tagline: "A tagline.",
    href: "/ana",
    role: "owner",
    trips: [{ id: "alps", title: "Four days round the Alps", href: "/ana/trips/alps", through: "owner" }],
    ...over,
  };
}

describe("your journals", () => {
  test("names the journal, its trips and the address that opened them", () => {
    const html = render(<YourJournals email="ana@example.test" journals={[journal()]} />);
    expect(html).toContain("Two Backpacks");
    expect(html).toContain("Four days round the Alps");
    expect(html).toContain("ana@example.test");
    expect(html).toContain('href="/ana/trips/alps"');
  });

  /**
   * The three roles read differently, because the whole point of one list is
   * that it mixes them. A guest journal labelled "Yours" is a page telling
   * somebody they own something they do not.
   */
  test("each role gets its own words", () => {
    const owner = render(<YourJournals email="a@e.test" journals={[journal({ role: "owner" })]} />);
    const traveller = render(
      <YourJournals email="a@e.test" journals={[journal({ role: "traveller" })]} />,
    );
    const guest = render(<YourJournals email="a@e.test" journals={[journal({ role: "guest" })]} />);

    expect(owner).toContain("Yours");
    expect(traveller).toContain("You travelled");
    expect(guest).toContain("Shared with you");

    // And the strong claim is not made about the weak cases.
    expect(traveller).not.toContain(">Yours<");
    expect(guest).not.toContain(">Yours<");
  });

  /** Publishing is the owner's, and only the owner's — B28. The hint that
   * points at the agent instruction must not appear on somebody else's. */
  test("only an owner is told the journal is theirs to publish", () => {
    expect(render(<YourJournals email="a@e.test" journals={[journal({ role: "owner" })]} />)).toContain(
      "Yours to publish",
    );
    expect(
      render(<YourJournals email="a@e.test" journals={[journal({ role: "guest" })]} />),
    ).not.toContain("Yours to publish");
  });

  /**
   * B264 is the same shape one level down: a reader who may see nothing was
   * told "there are no trips yet", which is a statement about the journal
   * rather than about them. An empty heading with nothing under it would be
   * this page's version.
   */
  test("nobody with no journals is left staring at an empty heading", () => {
    const html = render(<YourJournals email="nils@example.test" journals={[]} />);
    expect(html).toContain("Nothing yet");
  });

  test("a long trip list is cut short rather than becoming the page", () => {
    const trips = Array.from({ length: 9 }, (_, i) => ({
      id: `t${i}`,
      title: `Trip ${i}`,
      href: `/ana/trips/t${i}`,
      through: "owner" as const,
    }));
    const html = render(<YourJournals email="a@e.test" journals={[journal({ trips })]} />);
    expect(html).toContain("Trip 0");
    expect(html).toContain("Trip 3");
    expect(html).not.toContain("Trip 4");
    expect(html).toContain("and 5 more");
  });
});

describe("your devices", () => {
  function device(over: Partial<HomeDevice> = {}): HomeDevice {
    return {
      id: "d1",
      createdAt: "2026-09-01T10:00:00.000Z",
      lastSeenAt: "2026-09-05T08:30:00.000Z",
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) AppleWebKit/605.1.15 Safari/604.1",
      current: true,
      ...over,
    };
  }

  test("says which device is the one being used", () => {
    const html = render(<YourDevices devices={[device()]} onRevoke={() => {}} />);
    expect(html).toContain("iPhone");
    expect(html).toContain("This device");
    expect(html).toContain("2026-09-05");
  });

  test("a device that has not been used since signing in says so", () => {
    const html = render(<YourDevices devices={[device({ lastSeenAt: null })]} onRevoke={() => {}} />);
    expect(html).toContain("Not used since signing in");
  });

  /** An unparseable user agent is not a reason to print a raw UA string at
   * somebody, nor to render a blank row. */
  test("an unrecognisable device still has a name", () => {
    const html = render(<YourDevices devices={[device({ userAgent: null })]} onRevoke={() => {}} />);
    expect(html).toContain("Unknown device");
  });

  test("no devices, no section", () => {
    expect(render(<YourDevices devices={[]} onRevoke={() => {}} />)).toBe("");
  });
});
