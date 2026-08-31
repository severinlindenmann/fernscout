import { afterEach, beforeEach, describe, expect, test } from "vitest";
import path from "node:path";
import {
  ConfigError,
  clearConfigCache,
  loadServerConfig,
  parseServerConfig,
  loadUserConfig,
  parseUserConfig,
} from "@/lib/config";

const FIXTURES = path.join(process.cwd(), "test", "fixtures", "content");

const VALID = {
  title: "T",
  tagline: "L",
  owner: { name: "A B", nickname: "A", email: "a@example.com" },
  startLocation: "X",
  defaultLocale: "en",
  locales: ["en", "de"],
  baseCurrency: "CHF",
  displayCurrencies: ["CHF", "EUR"],
  units: "metric",
  features: { reactions: { enabled: true } },
};

/** A deep copy the tests can corrupt one field at a time. */
function clone(): Record<string, unknown> & { features: Record<string, unknown> } {
  return JSON.parse(JSON.stringify(VALID));
}

/** The problems array, or a failure if it unexpectedly parsed. */
function problemsOf(raw: unknown): string[] {
  try {
    parseUserConfig("u", raw);
  } catch (err) {
    if (err instanceof ConfigError) return err.problems;
    throw err;
  }
  throw new Error("expected parseUserConfig to reject this config");
}

beforeEach(() => {
  process.env.CONTENT_DIR = FIXTURES;
  clearConfigCache();
});

afterEach(() => {
  delete process.env.CONTENT_DIR;
  clearConfigCache();
});

describe("loadUserConfig", () => {
  test("reads the config from the content root", () => {
    expect(loadUserConfig("u").title).toBe("Fixture Trip");
  });

  test("defaults every unlisted feature to its shipped state", () => {
    const features = loadServerConfig().features;
    expect(features.mail.enabled).toBe(false);
    expect(features.auth.enabled).toBe(false);
    expect(features.mail.transport).toBe("file");
  });

  test("names the file when it is missing", () => {
    process.env.CONTENT_DIR = path.join(FIXTURES, "does-not-exist");
    clearConfigCache();
    expect(() => loadUserConfig("u")).toThrow(/config\.json/);
  });
});

describe("parseUserConfig", () => {
  test("accepts a valid config", () => {
    expect(parseUserConfig("u", clone()).locales).toEqual(["en", "de"]);
  });

  test("reports a missing required field by name", () => {
    const raw = clone();
    delete raw.title;
    expect(problemsOf(raw)).toContainEqual(expect.stringContaining("title is missing"));
  });

  test("reports a wrong type by name and value", () => {
    const raw = clone();
    raw.title = 42;
    expect(problemsOf(raw)).toContainEqual(expect.stringContaining("title must be"));
  });

  test("rejects a defaultLocale that is not in locales", () => {
    const raw = clone();
    raw.defaultLocale = "fr";
    expect(problemsOf(raw)).toContainEqual(expect.stringContaining("defaultLocale"));
  });

  test("rejects displayCurrencies that omit the base currency", () => {
    const raw = clone();
    raw.displayCurrencies = ["EUR"];
    expect(problemsOf(raw)).toContainEqual(
      expect.stringContaining("must include baseCurrency"),
    );
  });

  test("rejects an unknown feature rather than ignoring it", () => {
    const raw = clone();
    raw.features.telepathy = { enabled: true };
    expect(problemsOf(raw)).toContainEqual(expect.stringContaining("features.telepathy"));
  });

  test("rejects a non-boolean enabled", () => {
    const raw = clone();
    raw.features.reactions = { enabled: "yes" };
    expect(problemsOf(raw)).toContainEqual(
      expect.stringContaining("features.reactions.enabled must be true or false"),
    );
  });

  test("collects every problem, not just the first", () => {
    const raw = clone();
    delete raw.title;
    raw.units = "furlongs";
    raw.features.reactions = { enabled: "yes" };
    expect(problemsOf(raw).length).toBeGreaterThanOrEqual(3);
  });

  test("rejects a locales array that is empty", () => {
    const raw = clone();
    raw.locales = [];
    expect(problemsOf(raw)).toContainEqual(expect.stringContaining("locales"));
  });
});

/**
 * Who made this instance, and where its source is.
 *
 * Both belong in config rather than in a component. The content folder's
 * promise is that somebody deletes it, drops in their own and has their own
 * site — and a name compiled into the landing page would greet every one of
 * their visitors with somebody else's. `test/depersonalised.test.ts` fails the
 * build over exactly that, which is how this ended up here.
 */
describe("owner", () => {
  test("reads name, nickname and email", () => {
    const cfg = parseUserConfig("u", clone());
    expect(cfg.owner).toEqual({ name: "A B", nickname: "A", email: "a@example.com" });
  });

  test("lower-cases and trims the address, as an address is compared", () => {
    const raw = clone();
    raw.owner = { name: "A B", nickname: "A", email: "  A@Example.COM " };
    expect(parseUserConfig("u", raw).owner.email).toBe("a@example.com");
  });

  test("an owner with no email parses — that journal is read-only", () => {
    const raw = clone();
    raw.owner = { name: "A B", nickname: "A" };
    expect(parseUserConfig("u", raw).owner.email).toBeUndefined();
  });

  test("rejects an owner that is not an object", () => {
    const raw = clone();
    raw.owner = "A B";
    expect(problemsOf(raw)).toContain("owner must be { name, nickname, email? }");
  });

  test("rejects a malformed address rather than dropping it", () => {
    const raw = clone();
    raw.owner = { name: "A B", nickname: "A", email: "not-an-address" };
    expect(problemsOf(raw)).toContain("owner.email must be an email address, or absent");
  });

  test("names the migration when the old shape is still there", () => {
    const raw = clone();
    delete raw.owner;
    raw.travellers = [{ name: "A B", nickname: "A" }];
    raw.ownerEmail = "a@example.com";
    const problems = problemsOf(raw);
    expect(problems.some((p) => p.includes("travellers"))).toBe(true);
    expect(problems.some((p) => p.includes("owner"))).toBe(true);
  });
});

describe("site.repository and site.credit", () => {
  test("are absent by default, and absent stays absent", () => {
    const config = parseServerConfig({ site: { name: "N", url: "https://x.test" } });
    expect(config.site.repository).toBeUndefined();
    expect(config.site.credit).toBeUndefined();
  });

  test("are read when given", () => {
    const config = parseServerConfig({
      site: {
        name: "N",
        url: "https://x.test",
        repository: "https://github.com/someone/theirs",
        credit: { name: "A Person", url: "https://example.test", countryCode: "ch" },
      },
    });
    expect(config.site.repository).toBe("https://github.com/someone/theirs");
    expect(config.site.credit).toEqual({
      name: "A Person",
      url: "https://example.test",
      countryCode: "CH",
    });
  });

  /** A footer link that goes nowhere is worse than no footer link. */
  test("refuse a URL that is not one, rather than putting it in an href", () => {
    expect(() => parseServerConfig({ site: { name: "N", url: "https://x.test", repository: "not a url" } }))
      .toThrow(/repository/);
    expect(() =>
      parseServerConfig({
        site: {
          name: "N",
          url: "https://x.test",
          credit: { name: "A", url: "javascript:alert(1)" },
        },
      }),
    ).toThrow(/credit\.url/);
  });

  test("a credit with no name is a mistake worth naming", () => {
    expect(() => parseServerConfig({ site: { name: "N", url: "https://x.test", credit: { url: "https://x.test" } } }))
      .toThrow(/credit\.name/);
  });

  test("a country code that is not one is refused", () => {
    expect(() =>
      parseServerConfig({ site: { name: "N", url: "https://x.test", credit: { name: "A", countryCode: "Switzerland" } } }),
    ).toThrow(/countryCode/);
  });
});
