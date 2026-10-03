// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import LocaleProvider from "@/components/LocaleProvider";
import RecordingPlan from "@/components/studio/location/RecordingPlan";
import { dictionaryFor } from "@/lib/locales";
import type { NotificationPermission, RouteRecordStatus } from "@/components/nativeShell";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const shell = vi.hoisted(() => ({
  permission: "granted" as NotificationPermission,
  armed: [] as string[],
  declined: [] as string[],
  status: {} as Record<string, RouteRecordStatus>,
  openAppSettings: vi.fn(),
  requestNotificationPermission: vi.fn(async () => ({ status: "granted" })),
}));

vi.mock("@/components/nativeShell", () => ({
  useNativeShell: () => true,
  armedOrDeclinedTrips: async () => ({ armed: shell.armed, declined: shell.declined }),
  notificationPermissionStatus: async () => ({ status: shell.permission }),
  requestNotificationPermission: shell.requestNotificationPermission,
  openAppSettings: shell.openAppSettings,
  routeStatus: async (id: string) => shell.status[id] ?? { state: "off" },
}));

let root: Root | undefined;
let container: HTMLDivElement | undefined;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 3, 12, 0));
  shell.permission = "granted";
  shell.armed = ["now", "later", "open"];
  shell.declined = ["no"];
  shell.status = {
    now: { state: "recording", since: "2026-10-01T08:00:00Z", openEnded: false },
    later: { state: "recording", since: "2026-10-02T08:00:00Z", openEnded: false },
    open: { state: "recording", since: "2026-09-01T08:00:00Z", openEnded: true },
  };
  shell.openAppSettings.mockReset();
  window.location.hash = "";
});

afterEach(() => {
  vi.useRealTimers();
  act(() => root?.unmount());
  container?.remove();
});

const trips = [
  { id: "now", title: "Now Trip", start: "2026-10-01", end: "2026-10-05" },
  { id: "later", title: "Later Trip", start: "2026-11-04", end: "2026-11-19" },
  { id: "open", title: "Open Trip", start: "2026-09-01", end: "2026-09-10" },
  { id: "alps", title: "Alps Trip", start: "2026-10-12", end: "2026-10-15" },
  { id: "no", title: "No Trip", start: "2026-10-20", end: "2026-10-22" },
  { id: "old", title: "Old Trip", start: "2025-01-01", end: "2025-01-05" },
];

async function mount() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <LocaleProvider dictionary={dictionaryFor("en")} locale="en">
        <RecordingPlan username="alex" trips={trips} />
      </LocaleProvider>,
    );
  });
}
const row = (id: string) => container!.querySelector(`#trip-${id}`)!;

describe("RecordingPlan", () => {
  test("shared state words, only current/future/open-ended trips", async () => {
    await mount();
    expect(row("now").textContent).toContain("Recording");
    expect(row("later").textContent).toContain("Records from Nov 4");
    expect(row("alps").textContent).toContain("Not decided");
    expect(row("no").textContent).toContain("Not this trip");
    expect(row("open").textContent).toContain("Recording"); // past dates, but armed
    expect(container!.querySelector("#trip-old")).toBeNull();
  });

  test("real texts at real times: stop = 00:00 two days after the last day; unarmed gets the before-trip notice and a link; armed gets none", async () => {
    await mount();
    expect(row("now").textContent).toContain("Oct 7, 12:00 AM");
    expect(row("now").textContent).toContain("“Recording for Now Trip has stopped.”");
    expect(row("now").textContent).not.toContain("starts tomorrow");
    expect(row("alps").textContent).toContain("Oct 11, 06:00 PM");
    expect(row("alps").textContent).toContain("“Your trip to Alps Trip starts tomorrow. Record your route?”");
    expect(row("alps").textContent).not.toContain("has stopped");
    expect(row("alps").querySelector("a")?.getAttribute("href")).toContain("/studio/trip?trip=alps#section-route");
    expect(row("open").textContent).toContain("Every 7 days");
    expect(row("open").textContent).toContain("Fernscout is still recording your route.");
    expect(row("no").textContent).toContain("No notice.");
    expect(row("no").querySelector("a")).toBeNull();
  });

  test("notifications off: no promised times, never-asked offers the ask, denied opens Settings", async () => {
    shell.permission = "unknown";
    await mount();
    expect(container!.textContent).toContain("none of these notices will come");
    expect(container!.textContent).not.toContain("“Recording for");
    expect(row("alps").textContent).toContain("Would ask on Oct 11, 06:00 PM");
    const btn = () => container!.querySelector("button")!;
    expect(btn().textContent).toBe("Allow reminders");
    act(() => root?.unmount());
    container!.remove();
    shell.permission = "denied";
    await mount();
    expect(btn().textContent).toBe("Open Settings");
    await act(async () => btn().click());
    expect(shell.openAppSettings).toHaveBeenCalled();
  });

  test("a #trip-<id> hash scrolls to and focuses its row after load", async () => {
    window.location.hash = "#trip-alps";
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    await mount();
    expect(scroll).toHaveBeenCalled();
    expect(document.activeElement).toBe(row("alps"));
  });
});
