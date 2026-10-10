import { describe, expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import LocaleProvider from "@/components/LocaleProvider";
import type { HomeJournal } from "@/components/HomeJournals";
import SignedInHome from "@/components/home/SignedInHome";
import { dictionaryFor } from "@/lib/locales";

/**
 * The two things the operator's home list has to survive — B493, B494.
 *
 * B480 put every journal on the instance into one person's list, which turned
 * `/` into a page rendering **other people's content**: six journals' titles,
 * taglines and trip titles, none of them written by the reader. Both bugs
 * below are that fact arriving.
 *
 * Neither can be asserted as a layout — jsdom has no widths — so what is
 * asserted is the class that produces it, next to the reason the class is
 * there. That is a weaker test than a screenshot and a much stronger one than
 * nothing: the failure mode both times was a `className` somebody tidied.
 */

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: React.ComponentProps<"a">) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const RUNNING = { status: "current" as const, start: "2026-10-04", end: "2026-10-14" };

/** Three hundred characters, no space — a real trip in `/xydhd-quiet`. */
const UNBROKEN = "x".repeat(300);

function journal(overrides: Partial<HomeJournal>): HomeJournal {
  return {
    username: "ana",
    title: "Two Backpacks",
    tagline: "Across and back",
    href: "/@ana",
    role: "owner",
    trips: [{ id: "alps", title: "Across the Alps", href: "/@ana/alps", through: "owner" }],
    ...overrides,
  };
}

function markup(journals: HomeJournal[], locale = "en"): string {
  return renderToStaticMarkup(
    <LocaleProvider locale={locale} dictionary={dictionaryFor(locale)}>
      <SignedInHome journals={journals} today="2026-10-10" />
    </LocaleProvider>,
  );
}

describe("a title nobody sane typed (B493)", () => {
  // B2508 moved the trip links into cards; B-2975 into rows and a strip. The
  // rule is the same — the title ends in an ellipsis inside a `min-w-0` cell,
  // and the whole title stays in `title=`.
  test("a trip row's title is capped and ellipsised rather than pushing the page wide", () => {
    const html = markup([
      journal({
        role: "guest",
        trips: [{ id: "x", title: UNBROKEN, href: "/@ana/x", through: "guest", ...RUNNING }],
      }),
    ]);
    expect(html).toMatch(/<li class="min-w-0">/);
    expect(html).toMatch(new RegExp(`title="${UNBROKEN}" class="[^"]*truncate`));
  });

  test("the own-trip strip is cut short, a friend's day title can break mid-word, a shared journal's name is cut short", () => {
    const own = markup([
      journal({ trips: [{ id: "x", title: UNBROKEN, href: "/@ana/x", through: "owner", ...RUNNING }] }),
    ]);
    expect(own).toMatch(new RegExp(`title="${UNBROKEN}" class="[^"]*truncate`));
    const friend = markup([
      journal({
        role: "guest",
        trips: [
          {
            id: "x",
            title: "t",
            href: "/@ana/x",
            through: "guest",
            ...RUNNING,
            latest: { slug: "d", title: UNBROKEN, date: "2026-10-09", href: "/@ana/d" },
          },
        ],
      }),
    ]);
    expect(friend).toMatch(/<h2[^>]*class="[^"]*break-words/);
    const shared = markup([
      journal({ role: "guest", title: UNBROKEN, trips: [{ id: "x", title: "t", href: "/@ana/x", through: "guest" }] }),
    ]);
    expect(shared).toMatch(new RegExp(`class="[^"]*truncate[^"]*">${UNBROKEN}`));
  });
});

describe("the operator's list (B494)", () => {
  const mine = journal({ username: "operator", title: "Mine", role: "owner" });
  const theirs = [
    journal({ username: "bo", title: "The Quiet Journal", role: "admin" }),
    journal({ username: "cy", title: "The Solo Journal", role: "admin" }),
  ];

  test("says it once, not once per journal", () => {
    const html = markup([mine, ...theirs]);
    const said = html.split("You reach these because you run this server").length - 1;
    expect(said).toBe(1);
  });

  test("their journals are rows under their own heading, not cards", () => {
    const html = markup([mine, ...theirs]);
    expect(html).toContain("Other journals on this server");
    // The trip links belong to the one journal that is actually theirs: the
    // operator's rows add no trip link of their own (the fixture's trips all
    // point at /@ana/alps).
    expect(html).toContain("Your trips");
    const links = (h: string) => h.split('href="/@ana/alps"').length - 1;
    expect(links(html)).toBe(links(markup([mine])));
  });

  test("an operator with no journal of their own still gets the section", () => {
    const html = markup(theirs);
    expect(html).toContain("Other journals on this server");
    // Not the empty state: they are not somebody nobody has approved yet.
    expect(html).not.toContain(dictionaryFor("en")["home.none"]);
  });

  test("everybody else sees exactly what they saw before", () => {
    const html = markup([journal({ role: "guest" })]);
    expect(html).not.toContain("Other journals on this server");
    expect(html).toContain("Two Backpacks");
  });
});

/**
 * B1948 — the owner's way into their own studio is a link, not prose. B2508
 * made it the Continue card's own button; B-2975 keeps it beside New trip.
 */
describe("the owner's card links into their own studio (B1948)", () => {
  test("Open the studio is a link to /[user]/studio", () => {
    const html = markup([journal({ username: "ana", role: "owner" })]);
    expect(html).toMatch(/<a href="\/@ana\/studio"[^>]*>Open the studio<\/a>/);
  });

  test("a reader or traveller on somebody else's journal gets no such link", () => {
    for (const role of ["guest", "traveller"] as const) {
      const html = markup([journal({ role })]);
      expect(html).not.toContain('href="/@ana/studio"');
    }
  });
});
