// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import NewTripFlow from "@/components/studio/trip/NewTripFlow";
import StudioBarProvider from "@/components/studio/StudioBar";
import LocaleProvider from "@/components/LocaleProvider";
import { dictionaryFor } from "@/lib/locales";
import { todayISO } from "@/components/studio/location/RecordingPlan";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/alex/studio/trip/new",
  useSearchParams: () => new URLSearchParams(),
}));

const shell = vi.hoisted(() => ({
  online: true,
  armRoute: vi.fn(),
  disarmRoute: vi.fn(),
}));

vi.mock("@/components/studio/useOnline", () => ({ useOnline: () => shell.online }));
vi.mock("@/components/nativeShell", () => ({
  useNativeShell: () => true,
  haptic: async () => {},
  armRoute: shell.armRoute,
  disarmRoute: shell.disarmRoute,
  refreshGpsToken: vi.fn(async () => ({ token: "t", expiresAt: "2099-01-01T00:00:00Z" })),
  locationPermission: async () => ({ status: "always", precise: true, canAskAlways: false }),
  notificationPermissionStatus: async () => ({ status: "granted" }),
  requestLocationPermission: vi.fn(),
  requestNotificationPermission: vi.fn(),
  openAppSettings: vi.fn(),
}));

/**
 * B2300 — the iPhone app's one three-way route choice on a new trip. Nothing
 * reaches native until the trip id is back; "Ask me" (untouched) never does.
 */
let root: Root | undefined;
let container: HTMLDivElement | undefined;

beforeEach(() => {
  shell.online = true;
  shell.armRoute.mockReset().mockResolvedValue({ state: "recording", since: "2099-10-11T10:00:00Z", openEnded: false });
  shell.disarmRoute.mockReset().mockResolvedValue({ state: "declined" });
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true, id: "alps" }), { status: 200 })));
});

afterEach(() => {
  vi.unstubAllGlobals();
  sessionStorage.clear();
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
});

async function mount(range: { start: string; end: string }) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <LocaleProvider dictionary={dictionaryFor("en")} locale="en">
        <StudioBarProvider username="alex">
          <NewTripFlow
            username="alex"
            visibilities={["guest", "public", "private"]}
            defaultVisibility="private"
            guestCount={0}
            guestsHref="/@alex/studio/readers"
            accents={["sky"]}
            existingTrips={[]}
            otherLocales={[]}
            defaultLocale="en"
            baseCurrency="CHF"
            currencies={["CHF"]}
            contacts={[]}
            figures={[]}
            journalFigures={[]}
            initialRange={{ ...range, photos: 0 }}
          />
        </StudioBarProvider>
      </LocaleProvider>,
    );
  });
  const title = container.querySelector("input[type=text]") as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(title, "Round the Alps");
    title.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const button = (text: string) => [...container!.querySelectorAll("button")].find((b) => b.textContent?.includes(text));
async function click(el: Element | null | undefined) {
  expect(el).toBeTruthy();
  await act(async () => {
    (el as HTMLElement).click();
  });
}
const create = () => click(button("Create trip"));

describe("NewTripFlow — route choice (iPhone app)", () => {
  test("untouched: states 'Ask me the evening before' and calls no native route method", async () => {
    await mount({ start: "2099-10-12", end: "2099-10-15" });
    expect(container!.querySelector("[data-route-choice]")!.textContent).toContain("Ask me the evening before");
    await create();
    expect(shell.armRoute).not.toHaveBeenCalled();
    expect(shell.disarmRoute).not.toHaveBeenCalled();
  });

  test("Record: arms the new trip's id after Create, and the done screen says from when", async () => {
    await mount({ start: "2099-10-12", end: "2099-10-15" });
    await click(button("Record my route from"));
    expect(shell.armRoute).not.toHaveBeenCalled();
    await create();
    expect(shell.armRoute).toHaveBeenCalledOnce();
    expect(shell.armRoute.mock.calls[0][0]).toMatchObject({ trip: "alps", start: "2099-10-12", end: "2099-10-15", title: "Round the Alps" });
    expect(container!.querySelector("[data-route-armed]")!.textContent).toContain("Records from");
  });

  test("Not this trip: declines for good, arms nothing", async () => {
    await mount({ start: "2099-10-12", end: "2099-10-15" });
    await click(button("Not this trip"));
    await create();
    expect(shell.disarmRoute).toHaveBeenCalledWith("alps", true);
    expect(shell.armRoute).not.toHaveBeenCalled();
  });

  test("a trip starting today: no evening-before choice, the box reads 'Not decided'", async () => {
    const today = todayISO(Date.now());
    await mount({ start: today, end: today });
    const box = container!.querySelector("[data-route-choice]")!;
    expect(box.textContent).toContain("Not decided");
    expect(box.textContent).not.toContain("Ask me the evening before");
    expect(box.textContent).toContain("Record my route from today");
    await create();
    expect(shell.armRoute).not.toHaveBeenCalled();
    expect(shell.disarmRoute).not.toHaveBeenCalled();
  });

  test("offline: the box is disabled, says why, and nothing is armed", async () => {
    shell.online = false;
    await mount({ start: "2099-10-12", end: "2099-10-15" });
    expect(container!.textContent).toContain("You're offline. Turn on Record my route from the trip's settings once it is made.");
    expect(container!.querySelector("[data-route-choice] summary")!.textContent).not.toContain("change");
    await create();
    expect(shell.armRoute).not.toHaveBeenCalled();
  });
});
