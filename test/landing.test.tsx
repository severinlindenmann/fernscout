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
import { dictionaryFor } from "@/lib/locales";
import LocaleProvider from "@/components/LocaleProvider";

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
      travellers: [{ name: "A B", nickname: "A" }],
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
        journals={journals}
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

  test("carries the exact link somebody hands to an agent", () => {
    const html = renderLanding();
    expect(html).toContain("fernscout.test");
    expect(html).toContain("/documentation.txt");
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
   * The copy control used to print "Copy link" in English on every language's
   * landing page: the translated label reached only its `aria-label`, so the
   * one visible control on the page was the one thing that did not translate.
   */
  test("the copy button reads in the reader's language", () => {
    const html = renderLanding("de");
    expect(html).toContain(dictionaryFor("de")["landing.copy"]);
    expect(html).not.toContain("Copy link");
  });
});
