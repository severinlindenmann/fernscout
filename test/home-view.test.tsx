import { describe, expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import LocaleProvider from "@/components/LocaleProvider";
import { YourDevices, type HomeDevice, type HomeJournal, type HomeTrip, type MineJournal } from "@/components/HomeJournals";
import SignedInHome, { pickContinue } from "@/components/home/SignedInHome";
import SignedInHeader from "@/components/home/SignedInHeader";
import { PlanStatusCard } from "@/app/me/AccountPage";
import { dictionaryFor } from "@/lib/locales";

/**
 * What the signed-in root page says — B411.
 *
 * The panel is client-rendered from `/api/v2/me/home`, so `test/home.test.ts`
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

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }), usePathname: () => "/" }));

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
    href: "/@ana",
    role: "owner",
    trips: [{ id: "alps", title: "Four days round the Alps", href: "/@ana/trips/alps", through: "owner" }],
    ...over,
  };
}

function trip(over: Partial<HomeTrip> = {}): HomeTrip {
  return { id: "alps", title: "Four days round the Alps", href: "/@ana/trips/alps", through: "owner", ...over };
}

function home(journals: HomeJournal[], opts: { photobook?: boolean; signup?: boolean } = {}) {
  return render(<SignedInHome journals={journals} photobookEnabled={opts.photobook} signupEnabled={opts.signup} />);
}

/**
 * B2508 — the signed-in home is a way back into the trip, not a directory.
 * What it must never do is say more than the payload does: a draft line with
 * no draft, a count nobody measured, or "yours" about somebody else's journal.
 */
describe("the signed-in home", () => {
  test("an owner gets Continue on their trip, with a link to it as readers see it", () => {
    const html = home([journal()]);
    expect(html).toContain("Continue");
    expect(html).toContain("Four days round the Alps");
    expect(html).toContain('href="/@ana/trips/alps"');
    expect(html).toContain('href="/@ana/studio/day/new?trip=alps"');
    expect(html).toContain('href="/@ana/studio"');
  });

  test("the draft line appears only when the payload names a draft", () => {
    expect(home([journal()])).not.toContain("Draft");
    const html = home([
      journal({ trips: [trip({ draft: { slug: "d3", title: "A wrong turn", date: "2026-09-14", href: "/x" } })] }),
    ]);
    expect(html).toContain("Draft · only you can see it");
    expect(html).toContain("A wrong turn");
    expect(html).toContain('href="/@ana/studio/day/edit?slug=d3"');
  });

  test("no figure is drawn that the payload did not carry", () => {
    const bare = home([journal()]);
    expect(bare).not.toMatch(/\d+ days?\b/);
    expect(bare).not.toContain("Latest day");
    const counted = home([journal({ trips: [trip({ days: 4, start: "2024-09-12", end: "2024-09-15" })] })]);
    expect(counted).toContain("4 days");
    expect(counted).toContain("2024");
  });

  test("the trip under way comes first, then the most recently written", () => {
    const j = journal();
    const old = { journal: j, trip: trip({ id: "old", start: "2024-01-01", status: "past" }) };
    const fresh = { journal: j, trip: trip({ id: "fresh", start: "2023-01-01", status: "past", draft: { slug: "d", title: "d", date: "2025-05-01", href: "" } }) };
    const now = { journal: j, trip: trip({ id: "now", start: "2020-01-01", status: "current" }) };
    expect(pickContinue([old, fresh])?.trip.id).toBe("fresh");
    expect(pickContinue([old, fresh, now])?.trip.id).toBe("now");
  });

  test("Ready for paper only for an ended trip with days, and only where books print", () => {
    const ended = journal({ trips: [trip({ status: "past", days: 5, end: "2023-06-01" })] });
    expect(home([ended])).not.toContain("Ready for paper");
    expect(home([ended], { photobook: true })).toContain("Ready for paper");
    expect(home([ended], { photobook: true })).toContain('href="/@ana/trips/alps/photobook"');
    const rehearsal = journal({ trips: [trip({ status: "past", days: 1, test: true })] });
    expect(home([rehearsal], { photobook: true })).not.toContain("Ready for paper");
    const empty = journal({ trips: [trip({ status: "past", days: 0 })] });
    expect(home([empty], { photobook: true })).not.toContain("Ready for paper");
  });

  test("an owner with no trip yet is offered the first one", () => {
    const html = home([journal({ trips: [] })]);
    expect(html).toContain('href="/@ana/studio/trip/new"');
  });

  /** Publishing and the studio are the owner's, and only the owner's — B28. */
  test("somebody else's journal never gets a studio link or the owner's words", () => {
    for (const role of ["guest", "traveller"] as const) {
      const html = home([journal({ role, trips: [trip({ through: role })] })]);
      expect(html).not.toContain('href="/@ana/studio');
      expect(html).not.toContain("Continue");
      expect(html).not.toContain(">Yours<");
      expect(html).toContain("Shared with you");
    }
  });

  test("a reader gets the newest shared day first, large", () => {
    const html = home([
      journal({
        role: "guest",
        trips: [
          trip({ id: "a", title: "Older trip", through: "guest", latest: { slug: "x", title: "Old day", date: "2024-01-01", href: "/@ana/trips/a/day/x" } }),
          trip({ id: "b", title: "Newer trip", through: "guest", latest: { slug: "y", title: "Over the Susten", date: "2025-09-01", href: "/@ana/trips/b/day/y", excerpt: "We left late." } }),
        ],
      }),
    ]);
    expect(html.indexOf("Over the Susten")).toBeLessThan(html.indexOf("Older trip"));
    expect(html).toContain("We left late.");
    expect(html).toContain('href="/@ana/trips/b/day/y"');
    // The board's badge needs a last-visit record nobody keeps.
    expect(html).not.toContain("New since");
  });

  test("the start-your-own card is for a reader only, and only where signup is on", () => {
    const reader = [journal({ role: "guest", trips: [trip({ through: "guest" })] })];
    expect(home(reader)).not.toContain("Travelling yourself soon?");
    expect(home(reader, { signup: true })).toContain("Travelling yourself soon?");
    expect(home(reader, { signup: true })).toContain('href="/welcome"');
    expect(home([journal()], { signup: true })).not.toContain("Travelling yourself soon?");
  });

  test("a dismissed card stays dismissed", () => {
    vi.stubGlobal("window", { localStorage: { getItem: () => "1", setItem: () => {} } });
    try {
      const reader = [journal({ role: "guest", trips: [trip({ through: "guest" })] })];
      expect(home(reader, { signup: true })).not.toContain("Travelling yourself soon?");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  /**
   * B264's shape one level down: somebody signed in with nothing is in a
   * real, explicable state, and an empty heading would look broken.
   */
  test("nobody with no journals is left staring at an empty heading", () => {
    expect(home([])).toContain("Nothing yet");
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

/**
 * B2519 — the signed-in header. An owner gets their own doors (and a phone
 * tab bar with the same ones); Prints only where a print route exists; a
 * reader-only person owns nothing to write in and gets none of them.
 */
describe("the signed-in header", () => {
  const header = (journals: HomeJournal[], prints = false, admin = false) =>
    render(<SignedInHeader siteName="Fernscout" email="ana@example.org" journals={journals} prints={prints} admin={admin} />);

  test("an owner gets Studio, Readers and a tab bar, Prints only when printing exists", () => {
    const html = header([journal()]);
    expect(html).toContain('href="/@ana/studio"');
    expect(html).toContain('href="/@ana/studio/readers"');
    expect(html).not.toContain("/@ana/studio/orders");
    expect(html).toContain("safe-area-inset-bottom");
    expect(header([journal()], true)).toContain('href="/@ana/studio/orders"');
  });

  test("a reader-only person gets the mark and the account, no owner doors", () => {
    const html = header([journal({ role: "guest" })], true);
    expect(html).not.toContain("/studio");
    expect(html).not.toContain("safe-area-inset-bottom");
    expect(html).toContain('href="/me"');
    expect(html).not.toContain('href="/admin"');
    expect(header([journal({ role: "guest" })], true, true)).toContain('href="/admin"');
  });
});

/**
 * `/me`'s compact plan card — B2622. Deliberately small: plan, renews/ends,
 * AI days left, and a button to the full "Your plan" panel on the studio
 * account page — not the meters and buy/cancel buttons that live there.
 */
describe("the /me plan status card", () => {
  const owned = (plan: NonNullable<MineJournal["plan"]>): MineJournal => ({
    ...journal(),
    plan,
  });

  test("names the plan, the renewal date and the AI days left, and links to the account page", () => {
    const html = render(
      <PlanStatusCard
        journal={owned({
          plan: "plus",
          periodEnd: "2027-09-30T00:00:00.000Z",
          cancelAtPeriodEnd: false,
          renews: true,
          aiDays: { unlimited: false, used: 34, allowed: 100 },
          storageGb: 10,
          hasStripeSubscription: true,
          source: "stripe",
          postcards: { used: 2, allowed: 3 },
          bookDiscountRappen: 1000,
        })}
      />,
    );
    expect(html).toContain("Plus");
    expect(html).toContain("Renews 2027-09-30");
    expect(html).toContain("34 of 100 AI days used");
    expect(html).toContain('href="/@ana/studio/account"');
    expect(html).toContain("Manage your plan");
  });

  test("Free has no renew/end date but still says the AI days left", () => {
    const html = render(
      <PlanStatusCard
        journal={owned({
          plan: "free",
          periodEnd: null,
          cancelAtPeriodEnd: false,
          renews: false,
          aiDays: { unlimited: false, used: 2, allowed: 10 },
          storageGb: 2,
          hasStripeSubscription: false,
          source: null,
          postcards: null,
          bookDiscountRappen: 0,
        })}
      />,
    );
    expect(html).toContain("Free");
    expect(html).not.toContain("Renews");
    expect(html).not.toContain("Ends ");
    expect(html).toContain("2 of 10 AI days used");
  });
});
