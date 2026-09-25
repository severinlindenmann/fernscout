import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import Landing from "@/components/Landing";
import { getUsernames, getUser } from "@/lib/users";
import { getTrips } from "@/lib/trips";
import { isIndexable } from "@/lib/access";
import { dictionaryFor, installedLocales } from "@/lib/locales";
import LocaleProvider from "@/components/LocaleProvider";
import { LOCALE_LABEL, translate } from "@/lib/i18n";
import { writeTripFixture } from "./fixtures/content";

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
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));

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
  whatsappNumber?: string,
  print: { postcards?: boolean; photobook?: boolean } = {},
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
        whatsappNumber={whatsappNumber}
        postcardsEnabled={print.postcards}
        photobookEnabled={print.photobook}
      />
    </LocaleProvider>,
  );
}

describe("the landing page", () => {
  test("renders with an empty content folder", () => {
    const html = renderLanding();
    expect(html).toContain("A travel journal you can write yourself — or hand to an agent.");
    // Nothing to show a stranger yet, and it says so rather than showing an
    // empty grid.
    expect(html).toContain("No journals yet");
  });

  test("carries the exact links somebody hands to an agent", () => {
    const html = renderLanding();
    expect(html).toContain("fernscout.test");
    expect(html).toContain("/documentation.txt");
    expect(html).toContain("/skill/add-a-day.md");
  });

  test("lists every journal with something public, as a link", () => {
    writeUser("example", "An example journey");
    writeUser("alex", "Alex on the road");
    const html = renderLanding();
    expect(html).toContain('href="/example"');
    expect(html).toContain('href="/alex"');
    expect(html).toContain("An example journey");
    expect(html).toContain("Alex on the road");
    expect(html).not.toContain("No journals yet");
  });

  /** A journal with nothing public is not something to show a stranger. */
  test("omits a journal that has no public trip", () => {
    writeUser("hidden", "Nothing to see", false);
    const html = renderLanding();
    expect(html).not.toContain("Nothing to see");
    expect(html).toContain("No journals yet");
  });

  test("states the rule the whole design rests on", () => {
    const html = renderLanding();
    expect(html).toMatch(/no CMS/i);
    expect(html).toMatch(/draft/i);
  });

  test("keeps the agent instruction primary when the helper is off", () => {
    // renderLanding() passes no `helperEnabled`, so this is every instance's
    // answer today — the /agent CTA must not appear, and the page is the one
    // it always was.
    const html = renderLanding();
    expect(html).not.toContain('href="/agent"');
  });

  /**
   * B2338 retired the WhatsApp door B1310/B1314 drew here (the button and
   * its `wa.me` lookup, and the `OrDivider` beside it) — WhatsApp is no
   * longer a way to write a trip, so neither shows even when the app's own
   * `page.tsx` would once have had a number to pass down. The headline
   * variant that used to sit above the button is untouched (see "leads with
   * the WhatsApp headline only when a number is configured" below) — a
   * later ticket's job, per B2338's own scope note.
   */
  test("never offers a WhatsApp link, whatever a number prop says", () => {
    const html = renderLanding("en", false, "41780000000");
    expect(html).not.toContain("wa.me");
    expect(html).not.toContain("Start using WhatsApp");
    expect(html).not.toContain('role="separator"');
  });

  /**
   * B1711 — the pitch under the hero, and the two headlines above it.
   *
   * Both are the same bargain the rest of this page makes: the page may only
   * say what this instance can actually do. A stranger deciding whether to
   * trust a travel journal with a trip is the last reader who should be shown
   * a promise the server cannot keep.
   */
  describe("what the signed-out page claims", () => {
    test("leads with the WhatsApp headline only when a number is configured", () => {
      const withNumber = renderLanding("en", false, "41780000000");
      expect(withNumber).toContain("Send a voice note. Get a travel journal.");
      // B1717 — the hero shows `ChatVignette`, the same animated exchange
      // `/agent` opens with, and captions it with a link to the day its
      // photographs actually come from.
      expect(withNumber).toContain("oregon-coast");
      expect(withNumber).toContain("/example/trips/usa-2026/day/oregon-coast");

      const without = renderLanding();
      expect(without).toContain("A travel journal you can write yourself — or hand to an agent.");
      expect(without).not.toContain("Send a voice note");
      expect(without).not.toContain("oregon-coast");
    });

    test("names a postcard and a book only where they can be printed", () => {
      const both = renderLanding("en", false, undefined, {
        postcards: true,
        photobook: true,
      });
      expect(both).toContain("Real postcards, from the road");
      expect(both).toContain("The whole trip, printed");

      const cardsOnly = renderLanding("en", false, undefined, { postcards: true });
      expect(cardsOnly).toContain("Real postcards, from the road");
      expect(cardsOnly).not.toContain("The whole trip, printed");
    });

    test("drops the whole section when neither can be printed", () => {
      // The default — every self-hosted instance. The ownership card alone
      // under that heading only repeats the lede and the colophon.
      const html = renderLanding();
      expect(html).not.toContain("What happens to the day after you send it");
      expect(html).not.toContain("Real postcards");
    });
  });

  test("has no WhatsApp link when this instance has no number configured", () => {
    const html = renderLanding();
    expect(html).not.toContain("wa.me");
  });

  /**
   * B1905 — the hero's primary action used to be `href="/agent"`; it is now
   * a button that opens this same page's own sign-in (`IdentitySignIn`),
   * since a stranger reading this page owns no journal yet for `/agent` — or
   * the studio — to open. `/agent` is on a retirement path and this page
   * must not be one of its external doors.
   */
  test("leads with the sign-in button when the helper is on, bring-your-own still reachable", () => {
    const html = renderLanding("en", true);
    expect(html).not.toContain('href="/agent"');
    expect(html).toContain(translate(dictionaryFor("en"), "landing.helperCta"));
    // The instruction box and its copy button are still on the page, further
    // down — nothing about the helper being on removes the other door.
    expect(html).toContain("Copy instruction");
  });

  /**
   * B825 — the corner chip beside the locale switcher, for everybody rather
   * than the operator alone. Distinct from the hero's own sign-in button
   * above: this one is in `SiteHeader` and carries the `home.agentLink`
   * string, so it is asserted on its own by that string rather than a
   * shared `href`, since B1905 turned both into buttons that open sign-in
   * rather than links to `/agent`.
   *
   * The studio ticket renamed the string from "Agent" to "Sign in" — B1905
   * had already repointed the click handler at the page's own sign-in form,
   * but left the label claiming it opened an agent. It opens neither `/agent`
   * nor the studio; it opens `IdentitySignIn` right here, so the label now
   * says that.
   */
  test("offers a sign-in chip in the corner when the helper is on", () => {
    const html = renderLanding("en", true);
    expect(html).toContain(">Sign in<");
  });

  test("has no sign-in chip in the corner when the helper is off", () => {
    const html = renderLanding();
    expect(html).not.toContain(">Sign in<");
  });

  /**
   * B732 — the bring-your-own-agent material moves behind a native
   * disclosure, but only when the helper is the primary door. The three
   * pieces it reveals — the instruction box, the numbered steps, and the "no
   * CMS" paragraph — must still all be on the page; a `<details>` renders its
   * content in the static markup regardless of whether it starts open.
   */
  test("with the helper on, the bring-your-own material sits behind a disclosure", () => {
    const html = renderLanding("en", true);
    expect(html).toContain("<details");
    expect(html).toContain("<summary");
    // B748 — a chevron in the summary, distinguishing it from a plain link.
    const summary = html.slice(html.indexOf("<summary"), html.indexOf("</summary>"));
    expect(summary).toContain("lucide-chevron-down");
    expect(summary).toContain("group-open:rotate-180");
    // The trigger reuses the existing string rather than a new one.
    expect(html).toContain("Already have your own agent?");
    // No open attribute — closed by default.
    expect(html).not.toMatch(/<details[^>]*\bopen\b/);
    // Everything it reveals is still in the markup.
    expect(html).toContain("Copy instruction");
    expect(html).toMatch(/no CMS/i);
    expect(html).toContain("Give your agent the link");
  });

  /**
   * With the helper off there is no other door onto this material, so it
   * must stay open on the first screen exactly as before — no `<details>` at
   * all.
   */
  test("with the helper off, the material stays open on the page, not behind a disclosure", () => {
    const html = renderLanding();
    expect(html).not.toContain("<details");
    expect(html).toContain("Copy instruction");
    expect(html).toMatch(/no CMS/i);
  });

  /** B732 — `Read the docs` moves below the public journals in both
   * arrangements. */
  test("puts 'Read the docs' below the public journals", () => {
    writeUser("example", "An example journey");
    for (const helperOn of [false, true]) {
      const html = renderLanding("en", helperOn);
      expect(html.indexOf("Public journals on this server")).toBeLessThan(
        html.indexOf(">Read the docs<"),
      );
    }
  });

  test("invites the reader into the public journals", () => {
    writeUser("example", "An example journey");
    expect(renderLanding()).toMatch(/Public journals on this server/i);
  });

  test("carries no personal data — it is instance level", () => {
    writeUser("alex", "Alex on the road");
    const html = renderLanding();
    expect(html).not.toMatch(/@/);
  });

  /**
   * The landing page sits above `app/[user]/layout.tsx`, so there is no
   * `SiteProvider` over it. The switcher used to be a journal-only component
   * that read its language list from that context and threw without it, which
   * is why the one page a stranger sees first had no way to change language.
   */
  test("offers a language switcher, with no journal to ask", () => {
    // Only the chip is in the markup — the menu opens on click — so what is
    // assertable server-side is that the control is there, labelled in the
    // reader's language, and naming the language they are currently reading.
    const html = renderLanding("de");
    expect(html).toContain(`aria-label="${dictionaryFor("de")["lang.label"]}"`);
    expect(html).toContain(`title="${LOCALE_LABEL.de}"`);
    expect(html).toContain(">DE<");
  });

  /**
   * The copy control used to print "Copy link" in English on every language's
   * landing page: the translated label reached only its `aria-label`, so the
   * one visible control on the page was the one thing that did not translate.
   */
  test("the copy button reads in the reader's language", () => {
    const html = renderLanding("de");
    expect(html).toContain(dictionaryFor("de")["landing.copyInstruction"]);
    expect(html).not.toContain("Copy link");
  });

  /**
   * B254 — what the clipboard hands over has to stand on its own.
   *
   * The copied value used to be the bare documentation URL, which pasted into
   * an agent is an ambiguous instruction: it may fetch it, summarise it, or
   * ask what to do with it, and the email requirement was page prose that a
   * copy-paste leaves behind. The clipboard value is inside the click handler
   * and this suite renders to static markup, so the sentence is asserted from
   * the dictionary the component interpolates, and the button from the markup.
   */
  /**
   * B726 — `landing.noEditor` used to end "whether it's this instance's or
   * your own" on every arrangement, which is only true where `helper` is on.
   * The helper-off page must not claim this instance hosts an agent.
   */
  test("with the helper off, no sentence claims this instance hosts an agent", () => {
    const html = renderLanding();
    expect(html).toMatch(/no CMS/i);
    expect(html).not.toMatch(/whether it.{0,8}s this instance.{0,8}s or your own/i);
  });

  test("with the helper on, the closing clause names both possible agents", () => {
    const html = renderLanding("en", true);
    expect(html).toMatch(/whether it.{0,8}s this instance.{0,8}s or your own/i);
  });

  test("hands over an instruction, not a bare link", () => {
    const instruction = translate(dictionaryFor("en"), "landing.instruction", {
      docUrl: "https://fernscout.test/documentation.txt",
      agentUrl: "https://fernscout.test/skill/add-a-day.md",
    });
    expect(instruction).toContain("https://fernscout.test/documentation.txt");
    expect(instruction).toMatch(/email address I control/i);

    const html = renderLanding();
    // B255 — the block renders the instruction itself as its visible text,
    // the same string the button copies, not a postal-style host/path split.
    expect(html).toContain(instruction);
    expect(html).toContain("Copy instruction");
    // The name says what it copies rather than reciting the sentence — with
    // visible and copied text now identical it is no longer covering a
    // mismatch, but stays for the same reason as before (B199).
    expect(html).toContain('aria-label="Copy instruction"');
  });

  /**
   * B261 — a fetcher that refuses a URL discovered *inside* a fetched
   * document still reaches `/agent.md` if it arrived in the same pasted
   * sentence as `/documentation.txt`. Both must carry the instruction's own
   * provenance, and the paragraph must read as one instruction rather than a
   * list of links.
   */
  test("names both documents in the same instruction", () => {
    const instruction = translate(dictionaryFor("en"), "landing.instruction", {
      docUrl: "https://fernscout.test/documentation.txt",
      agentUrl: "https://fernscout.test/skill/add-a-day.md",
    });
    expect(instruction).toContain("https://fernscout.test/documentation.txt");
    expect(instruction).toContain("https://fernscout.test/skill/add-a-day.md");
    // One sentence, not a bulleted list — no line breaks or bullet markers.
    expect(instruction).not.toMatch(/\n|^[-*]/);

    const html = renderLanding();
    expect(html).toContain("fernscout.test/skill/add-a-day.md");
  });
});

/**
 * B470 — one door to the documentation, not three.
 *
 * The landing page linked `/docs`, `/docs/api` and `/docs/guide/guest`, so a
 * visitor met the documentation at three different depths depending on which
 * one they happened to press. The guest guide link outlived the other two
 * until the reader guides were retired; the sign-in card it sat under
 * explains itself.
 */
test("the landing page has one door to the docs", () => {
  const html = renderLanding();
  const hrefs = [...html.matchAll(/href="(\/docs[^"]*)"/g)].map((m) => m[1]);
  expect(new Set(hrefs)).toEqual(new Set(["/docs"]));
});
