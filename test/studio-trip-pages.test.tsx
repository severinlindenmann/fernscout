// @vitest-environment jsdom
import { act, isValidElement, type ReactElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * B2071/B2072 — the trip's one-question pages and Edit a trip as one page.
 */

const replace = vi.fn();
const search = { value: "" };
vi.mock("next/navigation", async (orig) => ({
  ...(await orig<typeof import("next/navigation")>()),
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace, refresh: vi.fn() }),
  usePathname: () => "/alex/studio/trip",
  useSearchParams: () => new URLSearchParams(search.value),
}));
vi.mock("@/lib/studio/pageGate", () => ({ requireStudioOwner: vi.fn(async () => {}) }));
vi.mock("@/lib/locales", async (orig) => ({
  ...(await orig<typeof import("@/lib/locales")>()),
  requestLocale: vi.fn(async () => "en"),
}));
const getTrips = vi.fn();
const getTrip = vi.fn();
vi.mock("@/lib/trips", async (orig) => ({
  ...(await orig<typeof import("@/lib/trips")>()),
  getTrips: (u: string) => getTrips(u),
  getTrip: (r: unknown) => getTrip(r),
}));

const { default: LocaleProvider } = await import("@/components/LocaleProvider");
const { default: StudioBarProvider } = await import("@/components/studio/StudioBar");
const { dictionaryFor } = await import("@/lib/locales");
const { default: TripVisibilityFlow } = await import("@/components/studio/trip/TripVisibilityFlow");
// B2291 — the preview of what a reader sees sits once under the two doors.
const { default: ReaderPreview } = await import("@/components/studio/readers/ReaderPreview");
const { plural, translate } = await import("@/lib/i18n");
const { default: TripEditFlow } = await import("@/components/studio/trip/TripEditFlow");
const { default: TripPicker } = await import("@/components/studio/trip/TripPicker");
const { default: PlanReadersPage } = await import("@/app/[user]/studio/trip/plan-readers/page");
const { default: TripEditPage } = await import("@/app/[user]/studio/trip/page");

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(() => {
  search.value = "";
  sessionStorage.clear();
  act(() => root?.unmount());
  container?.remove();
  vi.unstubAllGlobals();
});

function render(node: ReactNode) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
        <StudioBarProvider username="alex">{node}</StudioBarProvider>
      </LocaleProvider>,
    );
  });
  return container;
}

const preview = { id: "t", title: "Lisbon", status: "past", opens: true, publishedDays: 3, draftDays: 1, heldBackDays: 0, photoCount: 5, costsVisible: false };

describe("Who may read this trip — one page (B2071)", () => {
  const trip = { id: "lisbon", title: "Lisbon", visibility: "public", listed: true, teaser: false };
  const previews = { public: preview, guest: preview, private: { ...preview, opens: false } } as never;

  test("the current answer carries its badge after a space, not glued on", () => {
    const el = render(<TripVisibilityFlow username="alex" trip={trip} visibilities={["private", "public", "guest"]} previews={previews} />);
    expect(el.textContent).toContain("Public now");
    expect(el.textContent).not.toContain("Publicnow");
  });

  test("a failed PATCH says so on a role=alert line under the button", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "incomplete" }), { status: 422 })));
    const el = render(<TripVisibilityFlow username="alex" trip={trip} visibilities={["private", "public", "guest"]} previews={previews} />);
    // Narrowing asks nothing first, so the one press is the write.
    act(() => (el.querySelector('input[value="private"]') as HTMLInputElement).click());
    // StepPrimary lives in the studio bar only (B2076): one copy, at every width.
    const commit = [...el.querySelectorAll("button")].find((b) => b.textContent?.includes("Make it")) as HTMLButtonElement;
    expect(commit.textContent).toContain("Make it Private");
    await act(async () => commit.click());
    const alert = el.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("Nothing was changed");
  });
});

describe("What the audience does not see — B2130, B2132", () => {
  const trip = { id: "lisbon", title: "Lisbon", visibility: "public", listed: true, teaser: false };
  const theyDoNot = (el: HTMLElement) =>
    [...el.querySelectorAll("[data-they-do-not] li")].map((li) => li.textContent);
  const visibility = (p: typeof preview) =>
    render(<TripVisibilityFlow username="alex" trip={trip} visibilities={["private", "public", "guest"]} previews={{ public: p, guest: p, private: p } as never} />);

  test("one draft and one held-back day are two separate facts", () => {
    const el = visibility({ ...preview, draftDays: 1, heldBackDays: 1 });
    expect(theyDoNot(el)).toEqual(["1 draft day", "1 day held back", "what it cost"]);
  });

  test("a trip with only drafts says nothing about held-back days", () => {
    const el = visibility({ ...preview, draftDays: 2, heldBackDays: 0 });
    expect(theyDoNot(el)).toEqual(["2 draft days", "what it cost"]);
    expect(el.textContent).not.toContain("held back");
  });

  test("costs this audience sees move to what they see", () => {
    const el = visibility({ ...preview, costsVisible: true });
    expect(el.textContent).toContain("3 published days · 5 photographs · what it cost");
    expect(theyDoNot(el)).toEqual(["1 draft day"]);
  });

  // No steps since B2133: one section, the preview in a <details>.
  const invite = (p: typeof preview) => {
    const dict = dictionaryFor("en");
    return render(
      <ReaderPreview
        t={(key, vars) => translate(dict, key, vars)}
        tn={(key, count, vars) => plural(dict, key, count, vars)}
        preview={[p, { ...p, id: "c", title: "Closed", opens: false, publishedDays: 0, draftDays: 0, heldBackDays: 0, costsVisible: false }] as never}
      />,
    );
  };

  test("the invite promise follows whether a guest sees any costs", () => {
    expect(invite({ ...preview, costsVisible: false }).textContent).toContain("Costs are never shown to a guest");
    act(() => root?.unmount());
    container?.remove();
    const el = invite({ ...preview, costsVisible: true });
    expect(el.textContent).toContain("They see what the trips open to them cost");
    expect(el.textContent).not.toContain("never shown to a guest");
  });

  test("the invite preview lists costs a guest sees, and held-back days apart from drafts", () => {
    const el = invite({ ...preview, costsVisible: true, draftDays: 1, heldBackDays: 2 });
    expect(el.textContent).toContain("3 days · 5 photographs · what it cost");
    expect(theyDoNot(el)).toEqual(["1 draft day", "2 days held back", "1 private trip"]);
  });

  test("the invite preview says a guest does not see costs when no open trip shows them", () => {
    const el = invite({ ...preview, costsVisible: false });
    expect(theyDoNot(el)).toEqual(["1 draft day", "what the trips cost", "1 private trip"]);
  });
});

describe("Who sees the plan — takes ?trip= (B2071)", () => {
  const planned = (id: string) => ({ id, title: id, planSection: { readers: "map" } });

  function childrenOf(el: ReactElement): ReactNode[] {
    const kids = (el.props as { children?: ReactNode }).children;
    return (Array.isArray(kids) ? kids : [kids]).flatMap((k) => (isValidElement(k) ? [k, ...childrenOf(k)] : []));
  }

  test("without ?trip= it renders the picker, not the current trip", async () => {
    getTrips.mockReturnValue([planned("a"), planned("b"), { id: "c", title: "c" }]);
    const page = (await PlanReadersPage({
      params: Promise.resolve({ user: "alex" }),
      searchParams: Promise.resolve({}),
    } as never)) as ReactElement;
    const picker = childrenOf(page).find((k) => isValidElement(k) && k.type === TripPicker) as ReactElement | undefined;
    expect(picker).toBeDefined();
    // Only trips with a plan are offered.
    expect((picker!.props as { trips: { id: string }[] }).trips.map((t) => t.id)).toEqual(["a", "b"]);
  });
});

describe("Edit a trip — one page (B2072)", () => {
  const panel = {
    id: "lisbon",
    title: "Lisbon",
    tagline: "",
    start: "2025-05-01",
    end: "2025-05-09",
    visibility: "public" as const,
    listed: true,
    hasPlan: false,
    planReaders: "map" as const,
    planLevels: ["map", "details"] as const,
    costsPublic: false,
  };

  test("the bar's one primary is the Save", () => {
    const el = render(<TripEditFlow username="alex" trips={[{ id: "lisbon", title: "Lisbon" }]} trip={panel} />);
    const barButtons = [...el.querySelectorAll("button")].filter((b) => !b.closest("section"));
    // B2070 — a Save writes, so it carries the yellow commit tone.
    const primaries = barButtons.filter((b) => b.className.includes("bg-yellow-400"));
    expect(primaries.map((b) => b.textContent)).toEqual(["Save"]);
    expect(barButtons.filter((b) => b.className.includes("bg-action-strong"))).toEqual([]);
    // The address's "Rename it" is its own, inside its section — never the bar's.
    expect(el.querySelector("#section-address")?.textContent).toContain("Rename it");
  });

  // B2110 — rule 2: the h1 names the flow; the trip it edits is in the lede.
  test("with a chosen trip the title is Trips (B2134) and the trip is named in the lede", async () => {
    getTrips.mockReturnValue([{ id: "lisbon", title: "Lisbon" }, { id: "b", title: "b" }]);
    getTrip.mockReturnValue({ id: "lisbon", title: "Lisbon", start: "2025-05-01", end: "2025-05-09", visibility: "public", listed: true });
    const page = (await TripEditPage({
      params: Promise.resolve({ user: "alex" }),
      searchParams: Promise.resolve({ trip: "lisbon" }),
    } as never)) as ReactElement<{ title: string; lede?: string }>;
    expect(page.props.title).toBe("Trips");
    expect(page.props.lede).toBe("“Lisbon” — its dates, who may read it, its address.");
  });
});

describe("Record my route — native and capability gated (B2198)", () => {
  const panel = {
    id: "lisbon",
    title: "Lisbon",
    tagline: "",
    start: "2099-05-01",
    end: "2099-05-09",
    visibility: "public" as const,
    listed: true,
    hasPlan: false,
    planReaders: "map" as const,
    planLevels: ["map", "details"] as const,
    costsPublic: false,
  };
  const trips = [{ id: "lisbon", title: "Lisbon" }];

  afterEach(() => {
    delete (window as unknown as { Capacitor?: unknown }).Capacitor;
  });

  test("absent on the web, even with the capability on", () => {
    const el = render(<TripEditFlow username="alex" trips={trips} trip={panel} routeRecordingAvailable homeZoneReady />);
    expect(el.querySelector("#section-route")).toBeNull();
  });

  test("absent inside the shell when the capability is off", () => {
    (window as unknown as { Capacitor?: unknown }).Capacitor = { isNativePlatform: () => true };
    const el = render(<TripEditFlow username="alex" trips={trips} trip={panel} />);
    expect(el.querySelector("#section-route")).toBeNull();
  });

  test("present inside the shell with the capability on", () => {
    (window as unknown as { Capacitor?: unknown }).Capacitor = { isNativePlatform: () => true };
    const el = render(<TripEditFlow username="alex" trips={trips} trip={panel} routeRecordingAvailable homeZoneReady />);
    expect(el.querySelector("#section-route")).not.toBeNull();
    expect(el.querySelector("#section-route")?.textContent).toContain("Record my route");
  });
});
