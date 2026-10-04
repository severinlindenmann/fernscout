// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * B2848 — the locked card is on by default for a new closed trip, and trip
 * settings carry it (with the visitor's own card as a preview) and the route
 * colour under "Advanced".
 */

vi.mock("next/navigation", async (orig) => ({
  ...(await orig<typeof import("next/navigation")>()),
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/alex/studio/trip",
  useSearchParams: () => new URLSearchParams(""),
}));

const { clearConfigCache } = await import("@/lib/config");
const { clearUserCache } = await import("@/lib/users");
const { createTrip } = await import("@/lib/tripWrite");
const { getTrip } = await import("@/lib/trips");
const { default: LocaleProvider } = await import("@/components/LocaleProvider");
const { default: StudioBarProvider } = await import("@/components/studio/StudioBar");
const { dictionaryFor } = await import("@/lib/locales");
const { default: TripEditFlow } = await import("@/components/studio/trip/TripEditFlow");
const { LockedTripCard } = await import("@/app/at/[user]/trips/TripsIndexContent");
const { default: SiteProvider } = await import("@/components/SiteProvider");

let dir: string;
let root: Root | undefined;
let container: HTMLDivElement | undefined;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-b2848-"));
  process.env.CONTENT_DIR = dir;
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({ site: { name: "T", url: "https://t.test", defaultUser: "alex" }, features: {} }),
  );
  fs.mkdirSync(path.join(dir, "alex"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "alex", "config.json"),
    JSON.stringify({ title: "Alex", owner: { name: "A B", nickname: "A", email: "a@t.test" } }),
  );
  clearConfigCache();
  clearUserCache();
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  delete process.env.CONTENT_DIR;
  clearConfigCache();
  clearUserCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

function make(id: string, extra: Record<string, unknown>) {
  const r = createTrip("alex", { id, title: id, start: "2026-03-01", end: "2026-03-05", intro: "x", ...extra });
  if (!r.ok) throw new Error(r.error);
  return getTrip(`alex/${id}`)!;
}

describe("createTrip itself", () => {
  test("a closed trip with no teaser gets none (the default lives on the studio path)", () => {
    for (const v of ["guest", "private"]) {
      const stored = make(v, { visibility: v });
      expect(stored.teaser).toBeUndefined();
    }
    const raw = JSON.parse(fs.readFileSync(path.join(dir, "alex/trips/guest/trip.json"), "utf8"));
    expect("teaser" in raw).toBe(false);
  });
});

function render(node: ReactNode) {
  act(() => root?.unmount());
  container?.remove();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
        <SiteProvider value={{ base: "/@alex" } as never}>
          <StudioBarProvider username="alex">{node}</StudioBarProvider>
        </SiteProvider>
      </LocaleProvider>,
    );
  });
  return container;
}

const panel = {
  id: "lisbon",
  title: "Lisbon",
  tagline: "",
  start: "2026-03-01",
  end: "2026-03-05",
  visibility: "guest" as const,
  listed: false,
  teaser: true,
  hasPlan: false,
  planReaders: "map" as const,
  planLevels: ["map"] as never,
  costsPublic: false,
  intro: "",
  accent: "coral" as string | null,
  accents: ["sky", "yellow", "green", "coral", "navy"],
  costsAvailable: false,
  hasTranslations: false,
};

describe("Advanced group in trip settings", () => {
  test("holds Locked card with the visitor's own card, and Route colour", () => {
    const el = render(<TripEditFlow username="alex" trips={[{ id: "lisbon", title: "Lisbon" }]} trip={panel} />);
    const adv = el.querySelector("#section-advanced")!;
    expect(adv.textContent).toContain("Advanced");
    expect(adv.textContent).toContain("Locked card");
    expect(adv.textContent).toContain("Route colour");
    expect(adv.textContent).toContain("Automatic");
    // The preview is the same component, so it renders what the visitor card renders.
    const visitor = render(<LockedTripCard trip={{ id: "lisbon", title: "Lisbon", start: "2026-03-01", end: "2026-03-05" }} />);
    const card = visitor.querySelector("a")!.textContent;
    const el2 = render(<TripEditFlow username="alex" trips={[{ id: "lisbon", title: "Lisbon" }]} trip={panel} />);
    expect(el2.querySelector("[data-locked-card-preview] a")!.textContent).toBe(card);
    expect(card).toContain("Lisbon");
    // each colour is a route line, not a card swatch
    expect(adv.querySelectorAll("button svg path").length).toBe(6);
  });

  test("a public trip has no locked card control", () => {
    const el = render(<TripEditFlow username="alex" trips={[{ id: "lisbon", title: "Lisbon" }]} trip={{ ...panel, visibility: "public", teaser: undefined }} />);
    expect(el.querySelector("#section-advanced input[type=checkbox]")).toBeNull();
    expect(el.querySelector("[data-locked-card-preview]")).toBeNull();
  });

  test("saving the toggle sends teaser and leaves other fields alone", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const el = render(<TripEditFlow username="alex" trips={[{ id: "lisbon", title: "Lisbon" }]} trip={panel} />);
    const box = el.querySelector<HTMLInputElement>("#section-advanced input[type=checkbox]")!;
    await act(async () => box.click());
    const save = [...el.querySelectorAll("button")].find((b) => b.textContent === "Save")!;
    await act(async () => save.click());
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.teaser).toBe(false);
    expect("accent" in body).toBe(false);
    vi.unstubAllGlobals();
  });
});
