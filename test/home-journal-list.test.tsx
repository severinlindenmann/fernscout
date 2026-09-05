import { describe, expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import LocaleProvider from "@/components/LocaleProvider";
import { YourJournals, type HomeJournal } from "@/components/HomeJournals";
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

/** Three hundred characters, no space — a real trip in `/xydhd-quiet`. */
const UNBROKEN = "x".repeat(300);

function journal(overrides: Partial<HomeJournal>): HomeJournal {
  return {
    username: "ana",
    title: "Two Backpacks",
    tagline: "Across and back",
    href: "/ana",
    role: "owner",
    trips: [{ id: "alps", title: "Across the Alps", href: "/ana/alps", through: "owner" }],
    ...overrides,
  };
}

function markup(journals: HomeJournal[], locale = "en"): string {
  return renderToStaticMarkup(
    <LocaleProvider locale={locale} dictionary={dictionaryFor(locale)}>
      <YourJournals email="agent@example.test" journals={journals} />
    </LocaleProvider>,
  );
}

describe("a title nobody sane typed (B493)", () => {
  test("the trip link is capped and ellipsised rather than pushing the card wide", () => {
    const html = markup([
      journal({
        trips: [{ id: "x", title: UNBROKEN, href: "/ana/x", through: "owner" }],
      }),
    ]);
    // `truncate` is only an ellipsis if something bounds the width, and in a
    // `flex-wrap` row that something is `max-w-full` on both the item and the
    // link — with `min-w-0`, without which a flex item refuses to shrink below
    // its content and the card grows to 300 characters.
    expect(html).toMatch(/class="[^"]*min-w-0[^"]*max-w-full[^"]*"/);
    expect(html).toMatch(/class="[^"]*max-w-full truncate[^"]*"/);
    // The whole title stays available to a person who wants it.
    expect(html).toContain(`title="${UNBROKEN}"`);
  });

  test("a journal's own title and tagline can break mid-word", () => {
    const html = markup([journal({ title: UNBROKEN, tagline: UNBROKEN })]);
    const breaks = html.match(/break-words/g) ?? [];
    expect(breaks.length).toBeGreaterThanOrEqual(2);
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
    // The card's own furniture — the owner's hint and the trip links — belongs
    // to the one journal that is actually theirs.
    expect(html).toContain("Yours to publish");
    // Counted by href, not by title: the link carries the title twice, once
    // as text and once in the `title=` attribute B493 added.
    expect(html.split('href="/ana/alps"').length - 1).toBe(1);
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
    expect(html).toContain("Shared with you");
  });
});
