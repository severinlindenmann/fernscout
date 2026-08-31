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
    // The password hash must never appear anywhere reachable by an anonymous
    // request, feed included.
    expect(xml).not.toContain("scrypt$");
  });

  test("contains no unlisted trip content", () => {
    const xml = buildFeedXml("creator")!;
    expect(xml).not.toContain("UNLISTEDMARKERQUIET");
    expect(xml).not.toContain("A Quiet Day");
    expect(xml).not.toContain("unlisted-2026");
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
