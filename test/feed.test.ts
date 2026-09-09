import { afterEach, beforeEach, describe, expect, test } from "vitest";
import path from "node:path";
import { buildFeedXml } from "@/lib/feed";

/**
 * M5 — RSS must validate and must contain no non-public trip. This is the
 * package's highest-risk item: a feed is built by walking every trip rather
 * than rendering the one page a visitor asked for, which is exactly how a
 * private trip ends up reachable somewhere the HTML pages never link to it.
 */
const FIXTURES = path.join(process.cwd(), "test", "fixtures", "feed");

beforeEach(() => {
  process.env.CONTENT_DIR = FIXTURES;
});
afterEach(() => {
  delete process.env.CONTENT_DIR;
});

describe("buildFeedXml", () => {
  test("returns null for a user that does not exist", () => {
    expect(buildFeedXml("nobody")).toBeNull();
  });

  test("is well-formed XML", () => {
    const xml = buildFeedXml("creator")!;
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    // A cheap well-formedness check that doesn't require a full XML parser
    // dependency: every opening tag has a matching close, and no CDATA
    // section is left unterminated.
    const opens = xml.match(/<([a-zA-Z:]+)(?:\s[^>]*)?>/g)?.length ?? 0;
    const closes = xml.match(/<\/[a-zA-Z:]+>/g)?.length ?? 0;
    const selfClosing = xml.match(/<[a-zA-Z:]+(?:\s[^>]*)?\/>/g)?.length ?? 0;
    expect(opens - selfClosing).toBe(closes);
    expect(xml.split("<![CDATA[").length).toBe(xml.split("]]>").length);
  });

  test("contains the public trip's entry", () => {
    const xml = buildFeedXml("creator")!;
    expect(xml).toContain("PUBLICMARKERONE");
    expect(xml).toContain("A Public Day");
    expect(xml).toContain("/creator/trips/public-2026/day/somewhere");
  });

  /** The one that matters most. */
  test("contains no private trip content", () => {
    const xml = buildFeedXml("creator")!;
    expect(xml).not.toContain("PRIVATEMARKERSECRET");
    expect(xml).not.toContain("A Secret Day");
    expect(xml).not.toContain("Secretville");
    expect(xml).not.toContain("private-2026");
  });

  test("contains no unlisted trip content", () => {
    const xml = buildFeedXml("creator")!;
    expect(xml).not.toContain("UNLISTEDMARKERQUIET");
    expect(xml).not.toContain("A Quiet Day");
    expect(xml).not.toContain("unlisted-2026");
  });

  /**
   * B296 — the fix that made `GET .../days` include drafts touched one call
   * site inside that route, not the default `getAllEntries` runs with
   * everywhere else. This is the check that it stayed that way: a draft
   * living inside an otherwise *public* trip must still be invisible to a
   * reading path that walks every trip rather than answering one page's
   * request.
   */
  test("contains no draft, even inside an otherwise public trip", () => {
    const xml = buildFeedXml("creator")!;
    expect(xml).not.toContain("DRAFTMARKERHIDDEN");
    expect(xml).not.toContain("A Draft Day");
  });

  test("skips an upcoming trip (nothing written yet)", () => {
    const xml = buildFeedXml("creator")!;
    expect(xml).not.toContain("upcoming-2027");
  });

  test("channel metadata reflects the user, not the server", () => {
    const xml = buildFeedXml("creator")!;
    expect(xml).toContain("<title>Creator&apos;s journal</title>");
    expect(xml).toContain("<link>https://example.test/creator</link>");
  });
});

/**
 * B42 — `rfc822()` used to build `pubDate` as `` `${date}T${time}:00Z` ``,
 * which stamps a local wall clock with a literal `Z` and reads a Bangkok
 * morning as that same clock reading in UTC. Fixed to read the entry's own
 * `timezone`, falling back to the journal/instance zone (`journalTimezone()`
 * in lib/digest/quiet.ts) when an entry carries none.
 */
describe("pubDate reflects the entry's own zone, not a literal Z", () => {
  /**
   * Its own journal, not the `feed/` fixture the tests above share with
   * `test/search.test.ts`. That one is a *visibility* fixture whose document
   * count is asserted exactly, with a comment reasoning about which row each
   * trip contributes; two extra days for a clock made that comment wrong and
   * broke two assertions about privacy. See test/fixtures/feed-zones/README.md.
   */
  const ZONES = path.join(process.cwd(), "test", "fixtures", "feed-zones");

  const itemFor = (xml: string, marker: string) => {
    const at = xml.indexOf(marker);
    expect(at).toBeGreaterThan(-1);
    const start = xml.lastIndexOf("<item>", at);
    const end = xml.indexOf("</item>", at);
    return xml.slice(start, end);
  };

  beforeEach(() => {
    delete process.env.DIGEST_TIMEZONE;
    process.env.CONTENT_DIR = ZONES;
  });

  test("09:15 in Asia/Bangkok is 02:15 GMT, not 09:15 GMT", () => {
    const xml = buildFeedXml("zoner")!;
    const item = itemFor(xml, "ZONEDMARKERTWO");
    expect(item).toContain("<pubDate>Sun, 04 Jan 2026 02:15:00 GMT</pubDate>");
    expect(item).not.toContain("09:15:00 GMT");
  });

  test("an entry with a time and no timezone falls back to the journal's zone, not NaN", () => {
    const xml = buildFeedXml("zoner")!;
    const item = itemFor(xml, "UNTIMEZONEDMARKERTHREE");
    const match = item.match(/<pubDate>([^<]+)<\/pubDate>/);
    expect(match).not.toBeNull();
    const [, pubDate] = match!;
    expect(pubDate).not.toMatch(/Invalid|NaN/);
    expect(new Date(pubDate).toString()).not.toBe("Invalid Date");
    // Europe/Zurich (the default journal zone) is UTC+1 in January.
    expect(pubDate).toBe("Mon, 05 Jan 2026 08:15:00 GMT");
  });

  test("an entry with no time at all still gets a sane pubDate", () => {
    process.env.CONTENT_DIR = FIXTURES;
    const xml = buildFeedXml("creator")!;
    const item = itemFor(xml, "PUBLICMARKERONE");
    const match = item.match(/<pubDate>([^<]+)<\/pubDate>/);
    expect(match).not.toBeNull();
    expect(new Date(match![1]).toString()).not.toBe("Invalid Date");
  });
});
