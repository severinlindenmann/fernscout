import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import Landing from "@/components/Landing";
import type { ComponentProps } from "react";
import { getUsernames, getUser } from "@/lib/users";
import { getTrips } from "@/lib/trips";
import { isIndexable } from "@/lib/access";
import { dictionaryFor, installedLocales } from "@/lib/locales";
import LocaleProvider from "@/components/LocaleProvider";
import { LOCALE_LABEL, translate } from "@/lib/i18n";
import { writeDayFixture, writeTripFixture } from "./fixtures/content";
import { demoDay, excerptOf, type DemoDay } from "@/lib/demoDay";

/**
 * The landing page.
 *
 * The assertions that matter are about *what it says*, not how it looks: it
 * has to render on a fresh clone with nothing in `content/`, and it has to
 * carry the exact string somebody pastes into an agent. A landing page that
 * throws on an empty content folder fails at precisely the moment a new
 * self-hoster first opens it.
 */

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

// The language switcher refreshes the route so the server re-reads the cookie.
// There is no router in a `renderToStaticMarkup`, and the switcher is the only
// reason this file needs one.
// The language switcher and in-page links read the path (B2473).
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }), usePathname: () => "/" }));

let dir: string;

function writeServerConfig() {
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "Fernscout", url: "https://fernscout.test" },
      users: { reserved: [] },
      features: {},
    }),
  );
  clearConfigCache();
  clearUserCache();
}

function writeUser(username: string, title: string, withTrip = true) {
  fs.mkdirSync(path.join(dir, username), { recursive: true });
  fs.writeFileSync(
    path.join(dir, username, "config.json"),
    JSON.stringify({
      title,
      tagline: "A tagline",
      owner: { name: "A B", nickname: "A" },
      startLocation: "X",
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
      displayCurrencies: ["CHF"],
      units: "metric",
      features: {},
    }),
  );
  clearUserCache();
  if (withTrip) {
    writeTripFixture(username, {
      id: "a-trip",
      title: "A trip",
      start: "2026-01-01",
      end: "2026-01-05",
      status: "past",
    });
  }
  clearUserCache();
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-landing-"));
  process.env.CONTENT_DIR = dir;
  writeServerConfig();
});

afterEach(() => {
  delete process.env.CONTENT_DIR;
  clearConfigCache();
  clearUserCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

/** Mirrors app/page.tsx, which is a thin wrapper around this component. */
function renderLanding(
  locale = "en",
  helperEnabled = false,
  extra: Partial<ComponentProps<typeof Landing>> = {},
) {
  const journals = getUsernames().flatMap((username) => {
    const user = getUser(username);
    if (!user) return [];
    const trips = getTrips(username).filter(isIndexable);
    if (trips.length === 0) return [];
    return [{ username, title: user.title, tagline: user.tagline, trips: trips.length }];
  });
  return renderToStaticMarkup(
    <LocaleProvider locale={locale} dictionary={dictionaryFor(locale)}>
      <Landing
        siteName="Fernscout"
        docUrl="https://fernscout.test/documentation.txt"
        agentUrl="https://fernscout.test/skill/add-a-day.md"
        codeMinutes="30"
        journals={journals}
        locales={installedLocales()}
        helperEnabled={helperEnabled}
        {...extra}
      />
    </LocaleProvider>,
  );
}

const DEMO: DemoDay = {
  journalHref: "/@example",
  href: "/@example/trips/alps/day/over-the-pass",
  title: "Over the pass",
  date: "Thursday, 12 September 2024",
  location: "A pass",
  tripTitle: "Round the Alps",
  excerpt: "We left late.",
  photo: { src: "/@example/media/alps/over-the-pass/01.jpg", alt: "A hairpin" },
  cover: { src: "/@example/media/alps/over-the-pass/01.jpg", alt: "" },
  postcard: { src: "/@example/media/alps/into-italy/01.jpg", alt: "", title: "Into Italy" },
};

describe("the landing page", () => {
  test("renders with an empty content folder", () => {
    const html = renderLanding();
    expect(html).toContain("Your trip, told to the people at home.");
    // Nothing public: no demo card and no link to a demo that is not there.
    expect(html).not.toContain(translate(dictionaryFor("en"), "landing.demoLink"));
  });

  test("carries the exact links somebody hands to an agent", () => {
    const html = renderLanding();
    expect(html).toContain("fernscout.test");
    expect(html).toContain("/documentation.txt");
    expect(html).toContain("/skill/add-a-day.md");
  });

  /**
   * B2506 — the day beside the headline is a real published day, handed in
   * by the page (`lib/demoDay.ts`). The component only draws what it was
   * given: its title, its words, its place, and the links to it and its
   * journal.
   */
  test("draws the demo day it is given, linking the day and its journal", () => {
    const html = renderLanding("en", false, { demo: DEMO });
    expect(html).toContain("Over the pass");
    expect(html).toContain("We left late.");
    expect(html).toContain('href="/@example/trips/alps/day/over-the-pass"');
    expect(html).toContain('href="/@example"');
    expect(html).toContain("A new day: Over the pass");
    // /tour-operators' "Read a real trip" lands here (B2450).
    expect(html).toContain('id="journals"');
  });

  test("states the rule the whole design rests on", () => {
    const html = renderLanding();
    expect(html).toMatch(/no CMS/i);
    expect(html).toMatch(/draft/i);
  });

  test("keeps the agent instruction primary when the helper is off", () => {
    const html = renderLanding();
    expect(html).not.toContain('href="/agent"');
    // No hosted door either: /welcome cannot write without the helper.
    expect(html).not.toContain('href="/welcome"');
    expect(html).toContain("Copy instruction");
  });

  test("has no WhatsApp link", () => {
    expect(renderLanding()).not.toContain("wa.me");
  });

  /**
   * B1711, kept by B2506 — the page may only say what this instance can do.
   * The prints block exists only where a card or a book can be printed, and
   * says "book" only where the photobook exists.
   */
  describe("what the signed-out page claims", () => {
    test("names a postcard and a book only where they can be printed", () => {
      const both = renderLanding("en", false, { postcardsEnabled: true, photobookEnabled: true });
      expect(both).toContain('id="prints"');
      expect(both).toContain("Afterwards, it&#x27;s a book on the shelf.");
      expect(both).toContain("keep the trip as a book");

      const cardsOnly = renderLanding("en", false, { postcardsEnabled: true });
      expect(cardsOnly).toContain("A real postcard, from the road.");
      expect(cardsOnly).not.toContain("a book on the shelf");
      expect(cardsOnly).not.toContain("keep the trip as a book");
    });

    test("drops the prints block when neither can be printed", () => {
      const html = renderLanding();
      expect(html).not.toContain('id="prints"');
      expect(html).not.toContain(">Prints<");
    });

    test("names the assistant and dictation only where the helper is on", () => {
      expect(renderLanding()).not.toContain("The assistant can tidy");
      expect(renderLanding("en", true)).toContain("The assistant can tidy");
    });

    test("shows no plan, price or plan question without paid data", () => {
      const html = renderLanding();
      expect(html).not.toContain("CHF");
      expect(html).not.toContain("What does my first trip cost?");
      expect(html).not.toContain('id="prices"');
    });

    test("shows the plan line, plan questions and print prices it is handed", () => {
      const html = renderLanding("en", false, {
        postcardsEnabled: true,
        planPoint: "PLAN LINE",
        planFaq: [{ q: "PLAN Q", a: "PLAN A" }],
        printPrices: [{ label: "A card", price: "PRICE" }],
      });
      expect(html).toContain("PLAN LINE");
      expect(html).toContain("PLAN Q");
      expect(html).toContain("PRICE");
    });
  });

  /**
   * B2506 — one primary door everywhere. While signup is invite-only and the
   * request page exists (B2507) it is "Request an invite"; otherwise it is
   * `/welcome`, which needs the helper to write.
   */
  test("offers an invite request when the page says so, with its question", () => {
    const html = renderLanding("en", false, { inviteCta: "request" });
    expect(html).toContain('href="/invite"');
    expect(html).toContain("Request an invite");
    expect(html).toContain("Why do I need an invite?");
  });

  test("leads with /welcome when the helper is on, and drops the bring-your-own block", () => {
    const html = renderLanding("en", true);
    expect(html).not.toContain('href="/agent"');
    expect(html).toContain('href="/welcome"');
    expect(html).toContain(translate(dictionaryFor("en"), "landing.helperCta"));
    expect(html).not.toContain('href="/invite"');
    expect(html).not.toContain("Why do I need an invite?");
    // Agent material lives in the footer's docs link and /docs now.
    expect(html).not.toContain("Copy instruction");
    expect(html).toContain('href="/docs"');
  });

  /** B2506: "Sign in" sits in the header for everybody now — it opens the
   * same `IdentitySignIn` the reader strip does, which serves an owner and a
   * reader alike, so there is no instance on which it is a false door. */
  /** B2529 — the owner's review of the live page. */
  describe("after the owner's review", () => {
    test("the agent teaser is the last section before the footer", () => {
      const html = renderLanding("en", false, { pricing: <section id="prices" /> });
      const teaser = html.indexOf('aria-labelledby="agentic-teaser"');
      expect(teaser).toBeGreaterThan(html.indexOf('id="prices"'));
      expect(teaser).toBeGreaterThan(html.indexOf("Questions people ask first"));
      expect(html.indexOf("<footer")).toBeGreaterThan(teaser);
      expect(html.slice(teaser, html.indexOf("<footer"))).not.toContain("<section");
    });

    test("the iPhone line is a quiet line, only with a store link or a waitlist", () => {
      const line = dictionaryFor("en")["appWaitlist.line"];
      expect(renderLanding()).not.toContain(line);
      const waitlist = renderLanding("en", false, { appWaitlistAvailable: true });
      expect(waitlist).toContain(line);
      expect(waitlist).toContain(dictionaryFor("en")["appWaitlist.openCta"]);
      const store = renderLanding("en", false, { appStoreUrl: "https://apps.example/fernscout" });
      expect(store).toContain(line);
      expect(store).toContain('href="https://apps.example/fernscout"');
    });

    test("no plan string ties writing itself to a number of days", () => {
      for (const locale of installedLocales()) {
        for (const [key, value] of Object.entries(dictionaryFor(locale))) {
          if (!key.startsWith("plans.") || !value.includes("{days}")) continue;
          expect(value, `${locale} ${key}`).not.toMatch(/writing tool|Schreibwerkzeug|íróeszköz|outils d’écriture|strumenti di scrittura/i);
        }
      }
    });
  });

  test("offers sign-in in the header, helper on or off", () => {
    expect(renderLanding()).toContain(">Sign in<");
    expect(renderLanding("en", true)).toContain(">Sign in<");
  });

  test("carries no personal data — it is instance level", () => {
    writeUser("alex", "Alex on the road");
    const html = renderLanding();
    expect(html).not.toMatch(/@/);
  });

  /**
   * The landing page sits above `app/at/[user]/layout.tsx`, so there is no
   * `SiteProvider` over it. The switcher used to be a journal-only component
   * that read its language list from that context and threw without it, which
   * is why the one page a stranger sees first had no way to change language.
   */
  test("offers a language switcher, with no journal to ask", () => {
    const html = renderLanding("de");
    expect(html).toContain(`aria-label="${dictionaryFor("de")["lang.label"]}"`);
    expect(html).toContain(`title="${LOCALE_LABEL.de}"`);
    expect(html).toContain(">DE<");
  });

  test("the copy button reads in the reader's language", () => {
    const html = renderLanding("de");
    expect(html).toContain(dictionaryFor("de")["landing.copyInstruction"]);
    expect(html).not.toContain("Copy link");
  });

  test("with the helper off, no sentence claims this instance hosts an agent", () => {
    const html = renderLanding();
    expect(html).toMatch(/no CMS/i);
    expect(html).not.toMatch(/whether it.{0,8}s this instance.{0,8}s or your own/i);
  });

  test("hands over an instruction, not a bare link", () => {
    const instruction = translate(dictionaryFor("en"), "landing.instruction", {
      docUrl: "https://fernscout.test/documentation.txt",
      agentUrl: "https://fernscout.test/skill/add-a-day.md",
    });
    expect(instruction).toContain("https://fernscout.test/documentation.txt");
    expect(instruction).toMatch(/email address I control/i);

    const html = renderLanding();
    expect(html).toContain(instruction);
    expect(html).toContain("Copy instruction");
    expect(html).toContain('aria-label="Copy instruction"');
  });

  test("names both documents in the same instruction", () => {
    const instruction = translate(dictionaryFor("en"), "landing.instruction", {
      docUrl: "https://fernscout.test/documentation.txt",
      agentUrl: "https://fernscout.test/skill/add-a-day.md",
    });
    expect(instruction).toContain("https://fernscout.test/documentation.txt");
    expect(instruction).toContain("https://fernscout.test/skill/add-a-day.md");
    expect(instruction).not.toMatch(/\n|^[-*]/);

    const html = renderLanding();
    expect(html).toContain("fernscout.test/skill/add-a-day.md");
  });
});

/** B470 — one door to the documentation, not three. */
test("the landing page has one door to the docs", () => {
  const html = renderLanding();
  const hrefs = [...html.matchAll(/href="(\/docs[^"]*)"/g)].map((m) => m[1]);
  expect(new Set(hrefs)).toEqual(new Set(["/docs"]));
});

/**
 * B2506 — the demo day is read, never written. It comes from a listed public
 * journal (the shipped `example` first), skips drafts and days without an
 * open photograph, and carries the author's own first paragraph.
 */
describe("the demo day", () => {
  function publicTrip(user: string) {
    writeUser(user, `${user}'s journal`, false);
    writeTripFixture(user, { id: "t", title: "The trip", start: "2024-09-10", end: "2024-09-20", visibility: "public", status: "past" });
  }

  test("is nothing when nothing is public", () => {
    expect(demoDay("en")).toBeNull();
  });

  test("prefers the example journal, and a published day with an open photo", () => {
    publicTrip("alex");
    publicTrip("example");
    writeDayFixture(dir, "example", "t", { slug: "draft-one", date: "2024-09-11", status: "draft", content: "Draft words.", media: [{ src: "/media/t/a/01.jpg" }] });
    writeDayFixture(dir, "example", "t", { slug: "no-photo", date: "2024-09-12", content: "No photo here." });
    writeDayFixture(dir, "example", "t", { slug: "held", date: "2024-09-13", content: "Held photo.", media: [{ src: "/media/t/b/01.jpg", visibility: "private" }] });
    writeDayFixture(dir, "example", "t", { slug: "the-one", title: "The one", date: "2024-09-14", content: "First paragraph.\n\nSecond paragraph.", media: [{ src: "/media/t/c/01.jpg", caption: "A view" }] });
    clearUserCache();
    const day = demoDay("en");
    expect(day?.journalHref).toBe("/@example");
    expect(day?.title).toBe("The one");
    expect(day?.href).toBe("/@example/trips/t/day/the-one");
    expect(day?.excerpt).toBe("First paragraph.");
    expect(day?.photo.src).toContain("/c/01.jpg");
    expect(day?.photo.alt).toBe("A view");
  });

  test("cuts a long first paragraph at a sentence end", () => {
    const long = "One sentence here. ".repeat(30);
    const out = excerptOf(long, 60);
    expect(out.length).toBeLessThanOrEqual(60);
    expect(out.endsWith(".")).toBe(true);
  });
});
