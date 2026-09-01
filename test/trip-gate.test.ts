import { describe, expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * The trip gate, as a structural rule.
 *
 * A layout that returns something other than `children` changes what is
 * *displayed*. It does not stop the page component from running, and in the
 * App Router the page's data is serialised into the RSC payload and its
 * `generateMetadata` into the document head regardless. Relying on the layout
 * alone shipped a closed trip's day index — dates, locations,
 * coordinates, per-day spend — plus JSON-LD for every day and the day's own
 * prose in `<meta name="description">`, to anyone who opened the URL.
 *
 * Grepping the sources is a blunt instrument, but it is the one that catches
 * the failure that actually happens: somebody adds a page to one of these
 * route groups next year and never learns that the layout above it is not a
 * gate. A test that renders pages would not catch that — the new page would
 * simply not be in it.
 */

/** Both route groups that render a trip's own content. */
const GATED_DIRS = ["app/[user]/(trip)", "app/[user]/trips/[trip]"];

function pagesUnder(dir: string): string[] {
  const root = path.join(process.cwd(), dir);
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name === "page.tsx") out.push(full);
    }
  };
  walk(root);
  return out;
}

const pages = GATED_DIRS.flatMap(pagesUnder);

describe("every page behind the trip gate", () => {
  test("there are pages to check", () => {
    expect(pages.length).toBeGreaterThanOrEqual(10);
  });

  test.each(pages.map((p) => [path.relative(process.cwd(), p), p]))(
    "%s checks mayReadTrip itself",
    (_label, file) => {
      expect(fs.readFileSync(file, "utf8")).toContain("mayReadTrip");
    },
  );

  /**
   * A page whose metadata is built from an *entry* leaks the most: the title
   * names the place and the description is the day's own first 160 characters.
   * It has to answer `lockedMetadata` before it ever looks an entry up.
   */
  test.each(pages.map((p) => [path.relative(process.cwd(), p), p]))(
    "%s builds no metadata out of a locked entry",
    (_label, file) => {
      const src = fs.readFileSync(file, "utf8");
      const start = src.indexOf("export async function generateMetadata");
      if (start < 0) return; // static metadata, a constant — nothing to leak
      const body = src.slice(start, src.indexOf("\nexport ", start + 1));
      if (!body.includes("getEntryBySlug")) return; // trip title only

      expect(body).toContain("lockedMetadata");
      expect(body.indexOf("lockedMetadata")).toBeLessThan(body.indexOf("getEntryBySlug"));
    },
  );
});

describe("lockedMetadata", () => {
  test("emits no description, no Open Graph, and asks not to be indexed", async () => {
    const { lockedMetadata } = await import("@/lib/tripGate");
    const meta = lockedMetadata({ title: "Four days round the Alps" } as never);
    expect(meta.title).toBe("Four days round the Alps");
    expect(meta.description).toBeUndefined();
    expect(meta.openGraph).toBeUndefined();
    expect(meta.twitter).toBeUndefined();
    expect(meta.robots).toEqual({ index: false, follow: false });
  });
});
