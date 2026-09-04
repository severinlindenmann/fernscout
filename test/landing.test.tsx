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
  fs.mkdirSync(path.join(dir, username, "trips"), { recursive: true });
  if (withTrip) {
    const tripDir = path.join(dir, username, "trips", "a-trip");
    fs.mkdirSync(path.join(tripDir, "entries"), { recursive: true });
    fs.writeFileSync(
      path.join(tripDir, "trip.md"),
      [
        "---",
        "id: a-trip",
        'title: "A trip"',
        'start: "2026-01-01"',
        'end: "2026-01-05"',
        "status: past",
        "---",
        "",
        "Body.",
        "",
      ].join("\n"),
    );
  }
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
function renderLanding(locale = "en") {
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
        agentUrl="https://fernscout.test/agent.md"
        journals={journals}
        locales={installedLocales()}
      />
    </LocaleProvider>,
  );
}

describe("the landing page", () => {
  test("renders with an empty content folder", () => {
    const html = renderLanding();
    expect(html).toContain("A travel journal your agent writes for you.");
    // Nothing to show a stranger yet, and it says so rather than showing an
    // empty grid.
    expect(html).toContain("No journals yet");
  });

  test("carries the exact links somebody hands to an agent", () => {
    const html = renderLanding();
    expect(html).toContain("fernscout.test");
    expect(html).toContain("/documentation.txt");
    expect(html).toContain("/agent.md");
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
    expect(html).toMatch(/no editing interface/i);
    expect(html).toMatch(/draft/i);
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
  test("hands over an instruction, not a bare link", () => {
    const instruction = translate(dictionaryFor("en"), "landing.instruction", {
      docUrl: "https://fernscout.test/documentation.txt",
      agentUrl: "https://fernscout.test/agent.md",
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
      agentUrl: "https://fernscout.test/agent.md",
    });
    expect(instruction).toContain("https://fernscout.test/documentation.txt");
    expect(instruction).toContain("https://fernscout.test/agent.md");
    // One sentence, not a bulleted list — no line breaks or bullet markers.
    expect(instruction).not.toMatch(/\n|^[-*]/);

    const html = renderLanding();
    expect(html).toContain("fernscout.test/agent.md");
  });
});
