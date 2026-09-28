import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { NextRequest } from "next/server";
import { default as proxy } from "@/proxy";
import { LOCALE_COOKIE, PATH_HEADER } from "@/lib/requestKeys";
import { journalInPathname, journalPath, parseJournalPath } from "@/lib/journalPath";
import { writeTombstone } from "@/lib/tombstones";

/**
 * A journal's address is `/@<username>` — `lib/journalPath.ts`.
 *
 * The property that matters is structural: the app's own pages and people's
 * journals never share a namespace again, so a page added tomorrow cannot take
 * an address somebody already has, and a name picked today cannot hide a page.
 */

function get(url: string) {
  const request = new NextRequest(new URL(url, "https://journal.test"));
  const response = proxy(request);
  return { request, response };
}

/** Where a rewrite sends the request, as a path. */
function rewrittenTo(response: Response): string | null {
  const target = response.headers.get("x-middleware-rewrite");
  return target ? new URL(target).pathname + new URL(target).search : null;
}

describe("journalPath", () => {
  test("puts the @ in front of the name, and appends the rest as given", () => {
    expect(journalPath("anna")).toBe("/@anna");
    expect(journalPath("anna", "/trips/alps")).toBe("/@anna/trips/alps");
    expect(journalPath("anna", "?lang=de")).toBe("/@anna?lang=de");
  });

  test("parses only paths that are a journal's", () => {
    expect(parseJournalPath("/@anna")).toEqual({ username: "anna", rest: "" });
    expect(parseJournalPath("/@anna/day/x")).toEqual({ username: "anna", rest: "/day/x" });
    expect(parseJournalPath("/%40anna/day/x")).toEqual({ username: "anna", rest: "/day/x" });
    expect(parseJournalPath("/anna/day/x")).toBeNull();
    expect(parseJournalPath("/prices")).toBeNull();
    expect(parseJournalPath("/")).toBeNull();
    expect(parseJournalPath(null)).toBeNull();
    expect(journalInPathname("/@anna/studio")).toBe("anna");
    expect(journalInPathname("/docs/anna")).toBeNull();
  });
});

describe("the proxy serves /@user from the internal route", () => {
  test("a journal page is rewritten to app/at/[user], and the browser keeps the @ address", () => {
    const { request, response } = get("/@anna/trips/alps?x=1");
    expect(response.status).toBe(200);
    expect(rewrittenTo(response)).toBe("/at/anna/trips/alps?x=1");
    // The public path is what the pages read to learn whose journal this is.
    expect(request.headers.get(PATH_HEADER)).toBe("/@anna/trips/alps");
  });

  test("the journal's front page and its machine documents", () => {
    expect(rewrittenTo(get("/@anna").response)).toBe("/at/anna");
    expect(rewrittenTo(get("/@anna/feed.xml").response)).toBe("/at/anna/feed.xml");
    expect(rewrittenTo(get("/@anna/documentation.txt").response)).toBe("/at/anna/documentation.txt");
  });

  test("day markdown twins go to their route handler, whole slug included (B291)", () => {
    expect(rewrittenTo(get("/@anna/day/hoi-an.md").response)).toBe("/api/md/anna/hoi-an");
    expect(rewrittenTo(get("/@anna/day/v1.2.md").response)).toBe("/api/md/anna/v1.2");
    expect(rewrittenTo(get("/@anna/trips/alps/day/hoi-an.md").response)).toBe("/api/md/anna/alps/hoi-an");
  });

  test("?lang= still works on a journal path, on the same request", () => {
    const { request, response } = get("/@anna?lang=de");
    expect(request.cookies.get(LOCALE_COOKIE)?.value).toBe("de");
    expect(response.cookies.get(LOCALE_COOKIE)?.value).toBe("de");
    expect(rewrittenTo(response)).toBe("/at/anna?lang=de");
  });
});

describe("one address per page", () => {
  test("the internal route, asked for by name, redirects to the @ form", () => {
    const { response } = get("/at/anna/trips/alps?x=1");
    expect(response.status).toBe(308);
    expect(new URL(response.headers.get("location")!).pathname).toBe("/@anna/trips/alps");
    expect(new URL(response.headers.get("location")!).search).toBe("?x=1");
    expect(new URL(get("/at/anna").response.headers.get("location")!).pathname).toBe("/@anna");
  });

  test("an encoded @ converges on the literal one", () => {
    const { response } = get("/%40anna/day/x");
    expect(response.status).toBe(308);
    expect(new URL(response.headers.get("location")!).pathname).toBe("/@anna/day/x");
  });

  test("a bare /name is not rewritten into a journal", () => {
    const { response } = get("/anna/trips/alps");
    expect(rewrittenTo(response)).toBeNull();
    expect(response.headers.get("location")).toBeNull();
  });

  test("the API is left alone", () => {
    const { response } = get("/api/v2/anna/status");
    expect(rewrittenTo(response)).toBeNull();
  });
});

describe("a path that cannot be a journal is not rewritten", () => {
  /**
   * The rewrite target is assigned to a URL, which resolves dot segments. A
   * name of `..` or `%2e%2e` would otherwise serve `/admin` or `/api/…` at an
   * `@` address, past the header pins next.config.ts matched against it.
   */
  test("dot segments, in the name or after it, never leave the journal", () => {
    for (const bad of [
      "/@../admin",
      "/@%2e%2e/api/v2/x",
      "/@..",
      "/@./anna/contacts",
      "/@%2e/anna/contacts",
      "/@anna/%2e%2e/%2e%2e/admin",
      "/@anna/day/%2e%2e.md",
      "/@anna/trips/a%2Fb/day/x.md",
      "/@Anna",
      "/@anna/%zz",
    ]) {
      const { response } = get(bad);
      expect(rewrittenTo(response), bad).toBeNull();
      expect(response.headers.get("location"), bad).toBeNull();
    }
  });

  test("an .MD suffix is still a twin", () => {
    expect(rewrittenTo(get("/@anna/day/hoi-an.MD").response)).toBe("/api/md/anna/hoi-an");
  });

  test("the internal route spelled with an encoded letter still redirects", () => {
    const { response } = get("/%61t/anna/contacts");
    expect(response.status).toBe(308);
    expect(new URL(response.headers.get("location")!).pathname).toBe("/@anna/contacts");
  });
});

describe("a deleted journal", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-journal-path-"));
    process.env.CONTENT_DIR = dir;
    writeTombstone({
      kind: "journal",
      username: "gone",
      title: "Gone journal",
      deletedAt: "2026-01-01T00:00:00.000Z",
      requestedBy: "owner@example.test",
      held: { files: 0, bytes: 0 },
      notice: { lang: "en", title: "Gone", body: "Gone", homeLabel: "Home", homeHref: "/" },
    });
  });
  afterEach(() => {
    delete process.env.CONTENT_DIR;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("answers 410 at its @ address", () => {
    expect(get("/@gone").response.status).toBe(410);
    expect(get("/@gone/trips/alps").response.status).toBe(410);
  });

  test("leaves its markdown twins to the route that answers in plain text", () => {
    const { response } = get("/@gone/day/x.md");
    expect(response.status).toBe(200);
    expect(rewrittenTo(response)).toBe("/api/md/gone/x");
  });
});

describe("the app root has no dynamic segment", () => {
  /**
   * The whole point: with journals under `@`, nothing at the top level is
   * somebody's name. A `[param]` folder directly under `app/` would bring the
   * shared namespace back, and with it every collision this change removed.
   */
  test("no top-level folder under app/ is a dynamic route", () => {
    const app = path.join(process.cwd(), "app");
    const dynamic = fs
      .readdirSync(app, { withFileTypes: true })
      .filter((d) => d.isDirectory() && /^\[/.test(d.name))
      .map((d) => d.name);
    expect(dynamic).toEqual([]);
  });

  test("the journal pages live under app/at/[user]", () => {
    expect(fs.existsSync(path.join(process.cwd(), "app", "at", "[user]", "layout.tsx"))).toBe(true);
    // Nothing else under app/at: it is the proxy's rewrite target, not a page.
    expect(fs.readdirSync(path.join(process.cwd(), "app", "at"))).toEqual(["[user]"]);
  });

  /**
   * A journal link built by hand — `/${user}/studio` — skips the @ and 404s,
   * and no redirect catches it: the old addresses are not kept. The signed-in
   * header shipped exactly that on 28 Sep. Every journal link goes through
   * journalPath(); a template or concatenation that starts with a variable
   * segment is the shape that forgets it.
   */
  test("no source file builds a journal path by hand", () => {
    const handBuilt = /`\/\$\{[^}]+\}(\/|`)|["']\/["']\s*\+\s*[A-Za-z_]/;
    const found: string[] = [];
    const walk = (dir: string) => {
      if (!fs.existsSync(dir)) return;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== "node_modules" && entry.name !== "test") walk(full);
        } else if (/\.(ts|tsx|mts)$/.test(entry.name) && !/\.test\./.test(entry.name)) {
          fs.readFileSync(full, "utf8")
            .split("\n")
            .forEach((line, i) => {
              if (handBuilt.test(line) && !line.includes("not a journal path")) found.push(`${path.relative(process.cwd(), full)}:${i + 1}: ${line.trim()}`);
            });
        }
      }
    };
    for (const dir of ["app", "components", "lib", "paid"]) walk(path.join(process.cwd(), dir));
    expect(found).toEqual([]);
  });
});
