import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";

/**
 * B270: an owner whose only trip is `public, listed: false` used to see the
 * page's ordinary four-zeroes emptiness with no sentence at all —
 * `listableTrips` filters an unlisted public trip out for *everyone*, owner
 * included, deliberately (`test/access-gate.test.ts`, "the only trip the gate
 * opens without the switcher listing it is an unlisted public one" — the
 * owner row in that table has `switcher: false` for exactly this trip). So
 * `trips.length === 0` while `all.length > 0` is a real, reachable state for
 * an owner, and `page.tsx` had no branch for it: `owner: true` only ever fired
 * on genuine emptiness (`all.length === 0`).
 *
 * Modelled on `test/malformed-trips-page.test.tsx` — a page.tsx-level test
 * with `listableTrips` stubbed to the one rule this fixture exercises, so this
 * is about `page.tsx`'s own branch rather than a second copy of the gate's
 * table (which already covers that `listableTrips` itself filters correctly).
 */

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/alex/trips",
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-unlisted-owner-"));
  process.env.CONTENT_DIR = dir;
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "T", url: "https://t.test", defaultUser: "alex" },
      features: {},
    }),
  );
  fs.mkdirSync(path.join(dir, "alex", "trips", "quiet-2026", "entries"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "alex", "config.json"),
    JSON.stringify({ title: "Alex", owner: { name: "A B", nickname: "A", email: "a@t.test" } }),
  );
  // A trip that parses fine and is openable by anyone with the link —
  // `public` — but is not advertised, `listed: false`.
  fs.writeFileSync(
    path.join(dir, "alex", "trips", "quiet-2026", "trip.md"),
    [
      "---",
      'id: "quiet-2026"',
      'title: "Quiet"',
      'start: "2026-01-01"',
      'end: "2026-01-05"',
      'status: "past"',
      'visibility: "public"',
      "listed: false",
      "---",
      "",
      "Intro.",
      "",
    ].join("\n"),
  );
  clearConfigCache();
  clearUserCache();
});

afterEach(() => {
  delete process.env.CONTENT_DIR;
  clearConfigCache();
  clearUserCache();
  fs.rmSync(dir, { recursive: true, force: true });
  vi.resetModules();
});

/** The page's props for the given viewer, with `listableTrips` stubbed to the
 * one rule this fixture is about: `listed: false` filters a trip out. */
async function pageProps(owner: boolean) {
  vi.resetModules();
  vi.doMock("@/lib/contacts/session", () => ({ isOwner: async () => owner }));
  vi.doMock("@/lib/tripGate", () => ({
    listableTrips: async (t: { listed?: boolean }[]) => t.filter((trip) => trip.listed !== false),
    signedInAs: async () => null,
  }));
  const { default: TripsPage } = await import("@/app/[user]/trips/page");
  const element = (await TripsPage({
    params: Promise.resolve({ user: "alex" }),
    searchParams: Promise.resolve({}),
  } as never)) as { props: Record<string, unknown> };
  return element.props;
}

describe("an owner whose only trip is public but unlisted", () => {
  test("sees a filtered empty state naming the trip's own state, not four zeroes", async () => {
    const props = (await pageProps(true)) as { empty: unknown; trips: unknown[] };
    expect(props.trips).toEqual([]);
    expect(props.empty).toEqual({ owner: true, siteUrl: "https://t.test", filtered: true });
  });
});

/** Acceptance: whatever changes for the owner, a stranger's view of the same
 * journal is unchanged — asserted, not eyeballed. */
describe("a stranger looking at the same journal", () => {
  test("still gets the ordinary filtered-to-nothing shape, untouched by the owner's fix", async () => {
    const props = (await pageProps(false)) as { empty: unknown; trips: unknown[] };
    expect(props.trips).toEqual([]);
    // Byte-identical to a genuinely empty journal, per B264 — this reader must
    // not be able to tell a real-but-unlisted trip apart from no trip at all.
    expect(props.empty).toEqual({ owner: false, signedIn: false, ownerName: "A" });
  });
});
