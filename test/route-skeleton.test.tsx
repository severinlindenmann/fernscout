import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isValidElement, Suspense, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { writeDayFixture, writeTripFixture } from "./fixtures/content";
import RouteSkeleton from "@/components/RouteSkeleton";
import RouteBoundary from "@/components/RouteBoundary";
import LocaleProvider from "@/components/LocaleProvider";
import SiteProvider from "@/components/SiteProvider";
import CurrencyProvider from "@/components/CurrencyProvider";
import TripListProvider from "@/components/TripListProvider";
import { dictionaryFor } from "@/lib/locales";
import type { SiteSummary } from "@/lib/site";

/**
 * The reading pages that answer in two halves — components/RouteSkeleton.tsx
 * and components/RouteBoundary.tsx.
 *
 * A page settles everything about *whether* and *for whom* it exists (the
 * 404 for a draft slug, the redirect for a trip that became current, the gate
 * for a trip this reader may not open), then hands the heavy part to a
 * `RouteBoundary`, which puts it behind a `<Suspense>` with the skeleton as
 * fallback on a client-side navigation and draws no boundary at all on a
 * document load. Three properties make that safe, and each is held here:
 *
 * - **Every status is decided above the boundary.** A `notFound()` or a
 *   `redirect()` thrown from inside a `<Suspense>` is sent after the `200`
 *   has already gone out — which is exactly why this codebase has no
 *   `loading.tsx`. So a draft slug, a locked trip and a current trip's old URL
 *   must each answer from the page call itself, before any boundary exists.
 * - **The fallback carries nothing about the reader.** It is handed a shape
 *   and nothing else, and it is the same element for the owner and for a
 *   stranger. It is only ever rendered to a reader the page has let in.
 * - **A document load is untouched.** No boundary, so nothing is revealed
 *   late on React's reveal throttle; the body is the page's child exactly as
 *   it was before.
 *
 * Nothing here is cached, and nothing here could be: the boundary is per
 * request. What the reader is eventually sent below it is the same tree the
 * page returned before it had a boundary — test/support/serverTree.ts, and
 * the page tests that read their props through it, hold that.
 */

const jar = vi.hoisted(() => ({ cookies: {} as Record<string, string>, dest: null as string | null }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      jar.cookies[name] === undefined ? undefined : { value: jar.cookies[name] },
  }),
  // `Sec-Fetch-Dest`: `empty` for the router's `fetch()` of a navigation,
  // `document` for a page load, absent from anything that does not send it.
  headers: async () => ({ get: (name: string) => (name === "sec-fetch-dest" ? jar.dest : null) }),
}));
// The real `notFound`/`redirect` — they are what is under test — with the
// client hooks PageHeader reads answered for a render outside a router.
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  usePathname: () => "/alex/trips",
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));

const OWNER = "alex";
const OWNER_EMAIL = "alex@example.test";

let dir: string;
let ownerToken: string;

function writeContent() {
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "R", url: "https://example.test", defaultUser: OWNER },
      users: { reserved: [] },
      features: { auth: { enabled: true } },
    }),
  );
  fs.mkdirSync(path.join(dir, OWNER), { recursive: true });
  fs.writeFileSync(
    path.join(dir, OWNER, "config.json"),
    JSON.stringify({
      title: "Along the Ridge",
      owner: { name: "Alex Meyer", nickname: "Alex", email: OWNER_EMAIL },
      defaultLocale: "en",
      locales: ["en", "de"],
      baseCurrency: "CHF",
      features: { auth: { enabled: true } },
    }),
  );
  // Readable by anyone, with one published day and one draft.
  writeTripFixture(OWNER, {
    id: "ridge-2025",
    title: "Along the ridge",
    start: "2025-05-01",
    end: "2025-05-10",
    status: "past",
    visibility: "public",
  });
  writeDayFixture(dir, OWNER, "ridge-2025", {
    slug: "chur",
    date: "2025-05-02",
    title: "Chur",
    location: "Chur",
    country: "Switzerland",
    countryCode: "CH",
    coordinates: { lat: 46.8508, lng: 9.532 },
    content: "Arrived.",
  });
  writeDayFixture(dir, OWNER, "ridge-2025", {
    slug: "basel",
    date: "2025-05-03",
    title: "Basel",
    location: "Basel",
    country: "Switzerland",
    countryCode: "CH",
    coordinates: { lat: 47.5596, lng: 7.5886 },
    status: "draft",
    content: "Written, not yet published.",
  });
  // The owner's alone.
  writeTripFixture(OWNER, {
    id: "closed-2025",
    title: "Closed",
    start: "2025-06-01",
    end: "2025-06-05",
    status: "past",
    visibility: "private",
  });
  writeDayFixture(dir, OWNER, "closed-2025", {
    slug: "secret",
    date: "2025-06-02",
    title: "Secret",
    location: "Zug",
    country: "Switzerland",
    countryCode: "CH",
    coordinates: { lat: 47.1662, lng: 8.5155 },
    content: "Nobody else's.",
  });
  // Current, so its `/trips/<id>` URLs redirect to the bare ones.
  writeTripFixture(OWNER, {
    id: "now-2026",
    title: "Now",
    start: "2026-01-01",
    end: "2026-12-31",
    status: "current",
    visibility: "public",
  });
  writeDayFixture(dir, OWNER, "now-2026", {
    slug: "today",
    date: "2026-01-02",
    title: "Today",
    location: "Bern",
    country: "Switzerland",
    countryCode: "CH",
    coordinates: { lat: 46.948, lng: 7.4474 },
    content: "Here.",
  });
}

const asAnonymous = () => (jar.cookies = {});
const asOwner = () => (jar.cookies = { fs_session: ownerToken });

type Page = (props: never) => Promise<ReactNode>;
const load = async (file: string): Promise<Page> => (await import(`@/app/[user]/${file}`)).default;
const call = (page: Page, params: Record<string, string>) =>
  page({ params: Promise.resolve({ user: OWNER, ...params }) } as never);

type BoundaryProps = { shape: string; children: ReactNode };

/** The `RouteBoundary` elements in what a page returned, without rendering it. */
function boundaries(node: ReactNode): ReactElement<BoundaryProps>[] {
  if (Array.isArray(node)) return node.flatMap(boundaries);
  if (!isValidElement(node)) return [];
  if (node.type === RouteBoundary) return [node as ReactElement<BoundaryProps>];
  return boundaries((node.props as { children?: ReactNode }).children);
}

/** What Next's own `notFound()` and `redirect()` throw, told apart. */
async function thrown(p: Promise<unknown>): Promise<"404" | "redirect" | "nothing"> {
  try {
    await p;
    return "nothing";
  } catch (error) {
    const digest = String((error as { digest?: string }).digest ?? "");
    if (digest.startsWith("NEXT_HTTP_ERROR_FALLBACK;404")) return "404";
    if (digest.startsWith("NEXT_REDIRECT")) return "redirect";
    throw error;
  }
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-route-skeleton-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "db.sqlite")}`;
  process.env.SESSION_SECRET = "67".repeat(32);
  writeContent();

  const { issueCode, verifyCode } = await import("@/lib/auth");
  const { code } = await issueCode(OWNER, OWNER_EMAIL, "guest");
  const session = await verifyCode(OWNER, OWNER_EMAIL, code, "guest");
  if (!session.ok) throw new Error(`sign-in failed: ${session.reason}`);
  ownerToken = session.token;
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("every status is decided before the boundary", () => {
  test("a draft day's permalink is a 404 to a stranger, thrown by the page itself", async () => {
    asAnonymous();
    const page = await load("trips/[trip]/day/[slug]/page");
    expect(await thrown(call(page, { trip: "ridge-2025", slug: "basel" }))).toBe("404");
  });

  test("and is the story, behind a boundary, to its owner", async () => {
    asOwner();
    const page = await load("trips/[trip]/day/[slug]/page");
    expect(boundaries(await call(page, { trip: "ridge-2025", slug: "basel" }))).toHaveLength(1);
  });

  test("an unknown slug on the current trip is a 404 from the page itself", async () => {
    asAnonymous();
    const page = await load("(trip)/day/[slug]/page");
    expect(await thrown(call(page, { slug: "no-such-day" }))).toBe("404");
  });

  test.each([
    ["trips/[trip]/page", {}],
    ["trips/[trip]/day/[slug]/page", { slug: "today" }],
    ["trips/[trip]/map/page", {}],
  ])("the current trip's old address redirects from %s itself", async (file, extra) => {
    asAnonymous();
    expect(await thrown(call(await load(file), { trip: "now-2026", ...extra }))).toBe("redirect");
  });

  test.each([
    ["trips/[trip]/page", {}],
    ["trips/[trip]/day/[slug]/page", { slug: "secret" }],
    ["trips/[trip]/map/page", {}],
  ])("a trip a stranger may not open draws no boundary at all on %s", async (file, extra) => {
    asAnonymous();
    // `null`: the layout's gate is what they see, and the page never reaches
    // the point where a skeleton — or anything below it — exists.
    expect(await call(await load(file), { trip: "closed-2025", ...extra })).toBeNull();
  });
});

describe("the fallback carries nothing about the reader, and a document load has none", () => {
  const readable: [string, Record<string, string>, string][] = [
    ["trips/[trip]/page", { trip: "ridge-2025" }, "story"],
    ["trips/[trip]/day/[slug]/page", { trip: "ridge-2025", slug: "chur" }, "day"],
    ["trips/[trip]/map/page", { trip: "ridge-2025" }, "map"],
    ["(trip)/page", {}, "story"],
    ["(trip)/day/[slug]/page", { slug: "today" }, "day"],
    ["(trip)/map/page", {}, "map"],
    ["trips/page", {}, "list"],
  ];

  test.each(readable)("%s: a shape and nothing else, the same for owner and stranger", async (file, params, shape) => {
    const page = await load(file);
    asAnonymous();
    const stranger = boundaries(await call(page, params));
    asOwner();
    const owner = boundaries(await call(page, params));
    expect(stranger).toHaveLength(1);
    expect(owner).toHaveLength(1);
    for (const [boundary] of [stranger, owner]) {
      expect(Object.keys(boundary.props).sort()).toEqual(["children", "shape"]);
      expect(boundary.props.shape).toBe(shape);

      // A navigation: the body behind a `<Suspense>` whose fallback is the
      // skeleton, handed that shape and nothing else.
      jar.dest = "empty";
      const navigating = (await RouteBoundary(boundary.props as never)) as ReactElement<{
        fallback: ReactElement;
        children: ReactNode;
      }>;
      expect(navigating.type).toBe(Suspense);
      expect(navigating.props.fallback.type).toBe(RouteSkeleton);
      expect(navigating.props.fallback.props).toEqual({ shape });
      expect(navigating.props.children).toBe(boundary.props.children);

      // A document load, or a request that says nothing: the body itself,
      // with no boundary around it.
      for (const dest of ["document", null]) {
        jar.dest = dest;
        expect(await RouteBoundary(boundary.props as never)).toBe(boundary.props.children);
      }
    }
  });

  test("nothing but a script's own fetch counts as a navigation", async () => {
    for (const value of ["document", "iframe", "image", "EMPTY", ""]) {
      jar.dest = value;
      expect(await RouteBoundary({ shape: "day", children: "body" })).toBe("body");
    }
    jar.dest = null;
  });
});

describe("the reason there is no loading.tsx", () => {
  const APP = path.join(import.meta.dirname, "..", "app");

  /** A route fallback wraps the page, so every 404 below it streams as 200. */
  test("no route segment under a journal has one", () => {
    const found = (fs.readdirSync(path.join(APP, "[user]"), { recursive: true }) as string[]).filter(
      (f) => path.basename(f) === "loading.tsx" || path.basename(f) === "loading.js",
    );
    expect(found).toEqual([]);
  });

  /**
   * Source-level, because the property is about where a call *is*: a body
   * below the boundary that grew a `notFound()` would pass every behavioural
   * test above until the one slug that reaches it.
   */
  test("no body below a boundary can answer 404, redirect or gate", () => {
    const pages = (fs.readdirSync(path.join(APP, "[user]"), { recursive: true }) as string[])
      .filter((f) => f.endsWith("page.tsx"))
      .map((f) => path.join(APP, "[user]", f))
      .filter((f) => fs.readFileSync(f, "utf8").includes("<RouteBoundary"));
    expect(pages.length).toBeGreaterThanOrEqual(7);
    for (const file of pages) {
      const source = fs.readFileSync(file, "utf8");
      const bodies = source.split(/\nasync function \w+Body\(/).slice(1);
      expect(bodies.length, file).toBeGreaterThan(0);
      for (const body of bodies) {
        expect(body, file).not.toMatch(/\b(notFound|redirect|permanentRedirect|mayReadTrip)\(/);
      }
    }
  });
});

describe("the skeleton itself", () => {
  const site = {
    username: OWNER,
    title: "Along the Ridge",
    tagline: "",
    url: "https://example.test",
    baseCurrency: "CHF",
    locales: ["en", "de"],
    base: "/alex",
  } as unknown as SiteSummary;

  const render = (locale: string, shape: "story" | "day" | "map" | "list") =>
    renderToStaticMarkup(
      <LocaleProvider locale={locale} dictionary={dictionaryFor(locale)}>
        <SiteProvider value={site}>
          <CurrencyProvider options={{ base: "CHF", currencies: ["CHF"], rates: { CHF: 1 } }}>
            <TripListProvider trips={[]}>
              <RouteSkeleton shape={shape} />
            </TripListProvider>
          </CurrencyProvider>
        </SiteProvider>
      </LocaleProvider>,
    );

  test("keeps the real header over a placeholder body", () => {
    const html = render("en", "story");
    expect(html).toContain("<header");
    expect(html).toContain('data-route-skeleton="story"');
    expect(html).toContain('aria-busy="true"');
  });

  test("says what is happening, in the reader's language", () => {
    expect(render("en", "day")).toContain("Opening this page…");
    expect(render("de", "day")).toContain("Diese Seite wird geöffnet…");
  });
});
