// @scans app/at/**
import { describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import LocaleProvider from "@/components/LocaleProvider";
import { SiteFrame, type Audience } from "@/components/landing/Frame";
import { Band } from "@/components/landing/kit";
import { PILL_PRIMARY } from "@/components/landing/styles";
import { dictionaryFor } from "@/lib/locales";

/**
 * B2531's audience tints, rendered: a school or operator page wears its tint
 * on the stripe, the badge and the hero ground, and nowhere else — the one
 * primary button stays yellow on every page, so nobody wonders which to press.
 */

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }), usePathname: () => "/schools" }));

function frame(audience: Audience) {
  return renderToStaticMarkup(
    <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
      <SiteFrame
        audience={audience}
        badge={audience === "personal" ? undefined : "Schools"}
        siteName="Fernscout"
        inviteCta="request"
        helperEnabled={false}
        prints={false}
        pricing={false}
      >
        <Band tone="hero">
          <a href="#contact" className={PILL_PRIMARY}>
            Write to us
          </a>
        </Band>
      </SiteFrame>
    </LocaleProvider>,
  );
}

/** Every element's class list that holds the yellow pill. */
const pills = (html: string) =>
  [...html.matchAll(/class="([^"]*)"/g)].map(([, c]) => c).filter((c) => c.includes("bg-yellow-400") && c.includes("rounded-full"));

describe("the audience tints (B2531)", () => {
  test.each(["personal", "school", "operator"] as const)("%s: the primary button is the yellow pill, never the tint", (audience) => {
    const html = frame(audience);
    const found = pills(html);
    // The header's request-an-invite door and the page's own.
    expect(found.length).toBeGreaterThanOrEqual(2);
    for (const cls of found) {
      expect(cls).toContain("bg-yellow-400");
      expect(cls).toContain("border-navy-900");
      expect(cls).not.toMatch(/\btint/);
    }
  });

  test("a group page carries its audience class, the stripe and the badge; a personal page no class", () => {
    const school = frame("school");
    expect(school).toContain("audience-school");
    expect(school).toContain('class="h-1.5 bg-tint"');
    expect(school).toContain(">Schools<");
    expect(school).toContain("bg-tint-ground");
    expect(frame("operator")).toContain("audience-operator");
    const personal = frame("personal");
    expect(personal).not.toMatch(/audience-(school|operator)/);
    expect(personal).not.toContain(">Schools<");
  });

  test("no tint reaches a journal route", () => {
    // `/@user/…` is app/at: the owner's own frame. Nothing there may wear an
    // audience or read a tint token.
    const walk = (dir: string): string[] =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const full = path.join(dir, e.name);
        return e.isDirectory() ? walk(full) : /\.tsx?$/.test(e.name) ? [full] : [];
      });
    const offenders = walk(path.join(process.cwd(), "app", "at")).filter((file) =>
      /\baudience-(school|operator)\b|\b(bg|text|border)-tint\b|PageShell/.test(fs.readFileSync(file, "utf8")),
    );
    expect(offenders).toEqual([]);
  });
});
