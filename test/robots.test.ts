import { describe, expect, test } from "vitest";
import robots from "@/app/robots";
import { serverSite } from "@/lib/site";

/** B2486 — robots.txt exactly as the owner decided it. */
describe("robots.txt", () => {
  test("is the decided set of rules, and nothing else", () => {
    expect(robots()).toEqual({
      rules: [
        {
          userAgent: "*",
          allow: "/",
          disallow: ["/_next/", "/admin", "/*/studio", "/*/me", "/*/account", "/*/payment", "/w/", "/j/", "/t/"],
        },
      ],
      sitemap: `${serverSite().url}/sitemap.xml`,
    });
  });

  test("keeps /api crawlable and blocks no crawler by name", () => {
    const r = robots();
    const rules = Array.isArray(r.rules) ? r.rules : [r.rules];
    expect(rules.every((rule) => rule.userAgent === "*")).toBe(true);
    expect(JSON.stringify(rules)).not.toContain("/api");
    expect(r).not.toHaveProperty("host");
  });
});
