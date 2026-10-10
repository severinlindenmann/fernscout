import { describe, expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import LocaleProvider from "@/components/LocaleProvider";
import { YourDevices, type HomeDevice, type HomeJournal, type HomeTrip } from "@/components/HomeJournals";
import SignedInHome from "@/components/home/SignedInHome";
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

const TODAY = "2026-10-10";

function home(
  journals: HomeJournal[],
  opts: { photobook?: boolean; signup?: boolean; savedAt?: number | null } = {},
) {
  return render(
    <SignedInHome
      journals={journals}
      photobookEnabled={opts.photobook}
      signupEnabled={opts.signup}
      today={TODAY}
      savedAt={opts.savedAt}
    />,
  );
}

const running = { status: "current" as const, start: "2026-10-04", end: "2026-10-14" };
const past = { status: "past" as const, start: "2026-05-01", end: "2026-05-09" };

/**
 * B2508 — the signed-in home is a way back into the trip, not a directory — and
 * B-2975 — it leads with who is on the road. What it must never do is say more
 * than the payload does: a draft line with no draft, a count nobody measured,
 * a "Day 6" nobody counted, or "yours" about somebody else's journal.
 */
describe("the signed-in home", () => {
  test("an owner's running trip is a strip with the next step", () => {
    const html = home([journal({ trips: [trip(running)] })]);
    expect(html).toContain("On the road");
    expect(html).toContain("by trip dates");
    expect(html).toContain("You&#x27;re travelling");
    expect(html).toContain('href="/@ana/trips/alps"');
    expect(html).toContain('href="/@ana/studio/day/new?trip=alps"');
  });

  test("the draft line appears only when the payload names a draft", () => {
    expect(home([journal({ trips: [trip(running)] })])).not.toContain("A wrong turn");
    const html = home([
      journal({ trips: [trip({ ...running, draft: { slug: "d3", title: "A wrong turn", date: "2026-10-09", href: "/x" } })] }),
    ]);
    expect(html).toContain("A wrong turn");
    expect(html).toContain("Finish this day");
    expect(html).toContain('href="/@ana/studio/day/edit?slug=d3"');
  });

  test("a draft on a trip that has ended stays reachable", () => {
    const html = home([
      journal({ trips: [trip({ ...past, draft: { slug: "d3", title: "A wrong turn", date: "2026-05-08", href: "/x" } })] }),
    ]);
    expect(html).toContain("Draft · only you can see it");
    expect(html).toContain('href="/@ana/studio/day/edit?slug=d3"');
  });

  test("a draft on a trip that has not begun is a draft, not travelling, and is not counted on the road", () => {
    const html = home([
      journal({
        trips: [
          trip({
            status: "upcoming",
            start: "2026-11-01",
            end: "2026-11-09",
            draft: { slug: "d3", title: "Before the flight", date: "2026-11-01", href: "/x" },
          }),
        ],
      }),
    ]);
    expect(html).toContain("Draft · only you can see it");
    expect(html).toContain("Before the flight");
    expect(html).not.toContain("travelling");
    expect(html).not.toContain("On the road");
  });

  test("somebody who travelled on a friend's trip gets Read, and no studio", () => {
    const html = home([
      journal({
        role: "traveller",
        trips: [trip({ ...running, through: "traveller", latest: { slug: "x", title: "T", date: "2026-10-09", href: "/@ana/day/x" } })],
      }),
    ]);
    expect(html).toContain("You&#x27;re on this trip");
    expect(html).toContain('href="/@ana/day/x"');
    expect(html).not.toContain("/studio");
  });

  test("a friend who is running leads, with their name, place and a day to read", () => {
    const html = home([
      journal({
        role: "guest",
        owner: "Anna",
        trips: [
          trip({ id: "old", title: "Lisbon", through: "guest", ...past }),
          trip({
            id: "alps",
            title: "Alps loop",
            through: "guest",
            ...running,
            days: 3,
            latest: {
              slug: "cable",
              title: "Cable car in the rain",
              date: "2026-10-09",
              href: "/@ana/day/cable",
              excerpt: "Up we went.",
              location: "Grindelwald",
              country: "Switzerland",
            },
          }),
        ],
      }),
    ]);
    expect(html.indexOf("Cable car in the rain")).toBeLessThan(html.indexOf("Earlier"));
    expect(html).toContain("Anna · Alps loop");
    expect(html).toContain("Latest from Grindelwald, Switzerland");
    expect(html).toContain("Up we went.");
    expect(html).toContain("3 days you can read");
    expect(html).toContain('href="/@ana/day/cable"');
    // Past trips are a count, not a list of cards.
    expect(html).not.toContain("Lisbon");
  });

  test("a running trip with nothing readable says so rather than inventing a day", () => {
    const html = home([journal({ role: "guest", owner: "Ben", trips: [trip({ ...running, through: "guest", title: "Vietnam" })] })]);
    expect(html).toContain("Vietnam");
    expect(html).toContain("No days you can read yet");
    expect(html).not.toMatch(/Day \d/);
  });

  test("a running trip with nothing recent is quiet, not on the road", () => {
    const html = home([
      journal({
        role: "guest",
        trips: [
          trip({
            through: "guest",
            title: "Patagonia",
            start: "2026-08-01",
            end: "2026-11-30",
            status: "current",
            latest: { slug: "e", title: "E", date: "2026-09-12", href: "/e" },
          }),
        ],
      }),
    ]);
    expect(html).toContain("Quiet");
    expect(html).toContain("Patagonia");
    expect(html).not.toContain("On the road");
  });

  test("nobody running says so, names the next departure and offers the newest day", () => {
    const html = home([
      journal({
        role: "guest",
        owner: "Dana",
        trips: [
          trip({ id: "sic", title: "Sicily", through: "guest", status: "upcoming", start: "2026-10-21", end: "2026-10-30" }),
          trip({
            id: "lis",
            title: "Lisbon",
            through: "guest",
            ...past,
            latest: { slug: "a", title: "Last evening, Alfama", date: "2026-05-09", href: "/@ana/trips/lis/day/a" },
          }),
        ],
      }),
    ]);
    expect(html).toContain("No trip is running right now.");
    expect(html).toContain("Next: Sicily, starts");
    expect(html).toContain("Last evening, Alfama");
    expect(html).not.toContain("On the road");
  });

  test("history is a folded line with a count, linking to the trips page", () => {
    const html = home([journal({ trips: [trip({ id: "a", ...past }), trip({ id: "b", ...past })] })]);
    expect(html).toContain("Your trips");
    expect(html).toContain("2 ›");
    expect(html).toContain('href="/@ana/trips"');
    expect(html).toContain('href="/@ana/studio/trip/new"');
  });

  test("a trip that has not happened yet is named, and a rehearsal never is", () => {
    const html = home([
      journal({
        role: "guest",
        trips: [
          trip({ id: "u", title: "Sicily", through: "guest", status: "upcoming", start: "2026-10-21", end: "2026-10-30" }),
          trip({ id: "t", title: "Rehearsal", through: "guest", ...running, test: true }),
        ],
      }),
    ]);
    expect(html).toContain("Coming up");
    expect(html).toContain("Sicily");
    expect(html).not.toContain("Rehearsal");
  });

  test("no figure is drawn that the payload did not carry", () => {
    const html = home([
      journal({ role: "guest", trips: [trip({ ...running, through: "guest", latest: { slug: "x", title: "T", date: "2026-10-09", href: "/x" } })] }),
    ]);
    expect(html).not.toMatch(/\d+ days?\b/);
    expect(html).not.toContain("New since");
    expect(html).not.toMatch(/Day \d/);
  });

  test("a saved copy says when it was checked, and a fresh answer says nothing", () => {
    expect(home([journal()], { savedAt: null })).not.toContain("Saved copy");
    expect(home([journal()], { savedAt: Date.UTC(2026, 9, 9, 18, 40) })).toContain("Saved copy");
  });

  test("Ready for paper only for an ended trip with days, and only where books print", () => {
    const ended = journal({ trips: [trip({ status: "past", days: 5, end: "2023-06-01", start: "2023-05-01" })] });
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
      const html = home([journal({ role, trips: [trip({ ...past, through: role })] })]);
      expect(html).not.toContain('href="/@ana/studio');
      expect(html).not.toContain(">Yours<");
    }
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
    const operator = header([journal({ role: "guest" })], true, true);
    expect(operator).toContain('href="/admin"');
    // B2521: a wrench, not a visible word (the mocked Link keeps only href).
    expect(operator).toMatch(/href="\/admin"><svg[^>]*lucide-wrench/);
  });
});

/**
 * `/me`'s compact plan card — B2622. Deliberately small: plan, renews/ends,
 * AI days left, and a button to the full "Your plan" panel on the studio
 * account page — not the meters and buy/cancel buttons that live there.
 */
describe("the /me plan status card", () => {
  type CardJournal = Parameters<typeof PlanStatusCard>[0]["journal"];
  const owned = (plan: CardJournal["plan"]): CardJournal => ({
    ...journal(),
    role: "owner",
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
        passEndsAt: null,
        vouchers: [],
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
        passEndsAt: null,
        vouchers: [],
        })}
      />,
    );
    expect(html).toContain("Free");
    expect(html).not.toContain("Renews");
    expect(html).not.toContain("Ends ");
    expect(html).toContain("2 of 10 AI days used");
  });
});
