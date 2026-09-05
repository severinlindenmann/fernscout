import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import nextConfig from "@/next.config";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";

/**
 * B02 — what every response carries.
 *
 * Two halves, and they are tested apart because they are different promises.
 *
 * The first is the baseline every document gets: a CSP, a frame refusal, a
 * referrer policy, HSTS. None of it is exploitable today — there is no
 * `rehype-raw` and no upload path that lands markup — so this is the second
 * layer that exists for the day the first one fails.
 *
 * The second is the media route, and that one is not theoretical. `.svg` is a
 * script-bearing document served from the same origin as the session cookie.
 * The policy on that response has to hold whatever the rest of the site's does,
 * which is why it is asserted against the response the handler actually builds
 * rather than against configuration.
 */

type HeaderRule = { source: string; headers: { key: string; value: string }[] };

async function rules(): Promise<HeaderRule[]> {
  const headers = nextConfig.headers;
  expect(headers, "next.config.ts must declare a headers() block").toBeTypeOf("function");
  return (await headers!()) as HeaderRule[];
}

/**
 * The value that survives for a path.
 *
 * Next applies every matching rule in order and the last one to set a key
 * wins, so "which policy does a media file get" is a question about ordering,
 * not about which rule exists. Matching here is deliberately crude — the two
 * sources in play are `/:path*` and the media route — because the point is the
 * override, not path-to-regexp.
 */
function effective(all: HeaderRule[], key: string, matches: (source: string) => boolean) {
  let value: string | undefined;
  for (const rule of all) {
    if (!matches(rule.source)) continue;
    for (const header of rule.headers) {
      if (header.key.toLowerCase() === key.toLowerCase()) value = header.value;
    }
  }
  return value;
}

const anyPath = (source: string) => source.includes(":path*") && !source.includes("media");
const mediaPath = (source: string) => source.includes("media");

describe("the baseline headers on a document", () => {
  test("a CSP that refuses framing, plugins, base-tag rewriting and off-site forms", async () => {
    const csp = effective(await rules(), "Content-Security-Policy", anyPath);
    expect(csp).toBeDefined();
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("default-src 'self'");
  });

  test("scripts and styles may not be loaded from another origin", async () => {
    const csp = effective(await rules(), "Content-Security-Policy", anyPath);
    // `'unsafe-inline'` is still there — Next inlines its flight payload and
    // React sets style attributes — so this policy does not stop injected
    // markup from running. What it does stop is that markup reaching for a
    // script on somebody else's server, which is the step that turns an XSS
    // into an exfiltration.
    expect(csp).toMatch(/script-src [^;]*'self'/);
    expect(csp).not.toMatch(/script-src [^;]*https?:\/\//);
    expect(csp).toMatch(/style-src [^;]*'self'/);
  });

  test("the rest of the baseline", async () => {
    const all = await rules();
    expect(effective(all, "Referrer-Policy", anyPath)).toBe("strict-origin-when-cross-origin");
    expect(effective(all, "X-Content-Type-Options", anyPath)).toBe("nosniff");
    expect(effective(all, "X-Frame-Options", anyPath)).toBe("DENY");
    const hsts = effective(all, "Strict-Transport-Security", anyPath);
    expect(hsts).toMatch(/max-age=\d+/);
    // A year at least; anything shorter is a header that says nothing.
    expect(Number(/max-age=(\d+)/.exec(hsts ?? "")?.[1] ?? 0)).toBeGreaterThanOrEqual(31536000);
    // `preload` is a commitment somebody else's browser keeps for years and
    // that a self-hoster cannot undo. Deliberately absent.
    expect(hsts).not.toContain("preload");
  });

  test("the media route's own policy is declared after the baseline, so it wins", async () => {
    const all = await rules();
    const first = all.findIndex((rule) => anyPath(rule.source));
    const later = all.findIndex((rule) => mediaPath(rule.source));
    expect(first).toBeGreaterThanOrEqual(0);
    expect(later).toBeGreaterThan(first);
    const csp = effective(all, "Content-Security-Policy", mediaPath);
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("sandbox");
  });
});

describe("an SVG served out of somebody's content folder", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-headers-"));
    process.env.CONTENT_DIR = dir;
    fs.writeFileSync(
      path.join(dir, "config.json"),
      JSON.stringify({
        site: { name: "F", url: "https://example.test", defaultUser: "alex" },
        users: { reserved: [] },
        features: {},
      }),
    );
    fs.mkdirSync(path.join(dir, "alex", "trips", "asia-2023", "entries"), { recursive: true });
    fs.mkdirSync(path.join(dir, "alex", "trips", "asia-2023", "media", "day"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "alex", "config.json"),
      JSON.stringify({
        title: "Alex",
        tagline: "t",
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
    fs.writeFileSync(
      path.join(dir, "alex", "trips", "asia-2023", "trip.md"),
      [
        "---",
        "id: asia-2023",
        'title: "Asia"',
        'start: "2026-01-01"',
        'end: "2026-01-09"',
        "status: past",
        "visibility: public",
        "---",
        "",
        "Body.",
        "",
      ].join("\n"),
    );
    // The thing itself: an SVG that would run script if a browser ever treated
    // it as a document.
    fs.writeFileSync(
      path.join(dir, "alex", "trips", "asia-2023", "media", "day", "placeholder.svg"),
      `<svg xmlns="http://www.w3.org/2000/svg"><script>fetch("/api/v1/alex")</script></svg>`,
    );
    fs.writeFileSync(
      path.join(dir, "alex", "trips", "asia-2023", "media", "day", "photo.jpg"),
      Buffer.from([0xff, 0xd8, 0xff, 0xdb]),
    );
    clearConfigCache();
    clearUserCache();
  });

  afterEach(() => {
    delete process.env.CONTENT_DIR;
    clearConfigCache();
    clearUserCache();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  async function fetchMedia(file: string) {
    const { GET } = await import("@/app/[user]/media/[...path]/route");
    return GET(new Request(`https://example.test/alex/media/asia-2023/day/${file}`), {
      params: Promise.resolve({ user: "alex", path: ["asia-2023", "day", file] }),
    } as never);
  }

  test("is sandboxed and offered as a download, not run as a page", async () => {
    const response = await fetchMedia("placeholder.svg");
    expect(response.status).toBe(200);
    // Still an SVG — the demo content's placeholders have to keep rendering in
    // an <img>, and neither of these headers stops that.
    expect(response.headers.get("Content-Type")).toBe("image/svg+xml");
    const csp = response.headers.get("Content-Security-Policy");
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("sandbox");
    expect(response.headers.get("Content-Disposition")).toContain("attachment");
  });

  test("a photograph is sandboxed too, and is not offered as a download", async () => {
    const response = await fetchMedia("photo.jpg");
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/jpeg");
    expect(response.headers.get("Content-Security-Policy")).toContain("default-src 'none'");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    // A photograph a browser navigates to should still be a photograph.
    expect(response.headers.get("Content-Disposition")).toBeNull();
  });

  /**
   * B394: WebP is served whatever `Accept` says, so a shared cache needs
   * `Vary: Accept` to know the two are not interchangeable — otherwise a
   * client that only takes JPEG could be handed a cached WebP response.
   */
  test("carries Vary: Accept, regardless of what was sent", async () => {
    const withJpegOnly = await (
      await import("@/app/[user]/media/[...path]/route")
    ).GET(
      new Request("https://example.test/alex/media/asia-2023/day/photo.jpg", {
        headers: { accept: "image/jpeg" },
      }),
      { params: Promise.resolve({ user: "alex", path: ["asia-2023", "day", "photo.jpg"] }) } as never,
    );
    expect(withJpegOnly.headers.get("Vary")).toContain("Accept");
  });
});
