// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import LocaleProvider from "@/components/LocaleProvider";
import RouteRecordSection from "@/components/studio/trip/RouteRecordSection";
import { dictionaryFor } from "@/lib/locales";
import type { LocationPermission, RouteRecordStatus } from "@/components/nativeShell";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * "Record my route" never arms a recorder that would stop the moment the
 * owner leaves the app: whenever iOS's location permission is not already
 * "Always", the switch opens the walkthrough first, and only an "Always"
 * the owner actually granted leads on to arming.
 */
const shell = vi.hoisted(() => ({
  permission: null as unknown as LocationPermission,
  afterRequest: null as unknown as LocationPermission,
  status: { state: "off" } as RouteRecordStatus,
  armRoute: vi.fn(),
  requestLocationPermission: vi.fn(),
  openAppSettings: vi.fn(),
}));

vi.mock("@/components/nativeShell", () => ({
  useNativeShell: () => true,
  routeStatus: async () => shell.status,
  locationPermission: async () => shell.permission,
  requestLocationPermission: shell.requestLocationPermission,
  openAppSettings: shell.openAppSettings,
  armRoute: shell.armRoute,
  disarmRoute: vi.fn(),
  keepRecordingRoute: vi.fn(),
  refreshGpsToken: vi.fn(async () => ({ token: "t", expiresAt: "2099-01-01T00:00:00Z" })),
  needsGpsTokenRefresh: () => false,
}));

let root: Root | undefined;
let container: HTMLDivElement | undefined;

beforeEach(() => {
  shell.status = { state: "off" };
  shell.armRoute.mockReset().mockImplementation(async () => ({ state: "recording", since: "2026-09-25T10:00:00Z", openEnded: false }));
  shell.requestLocationPermission.mockReset().mockImplementation(async () => shell.afterRequest);
  shell.openAppSettings.mockReset();
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
});

async function mount() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <LocaleProvider dictionary={dictionaryFor("en")} locale="en">
        <RouteRecordSection username="alex" trip={{ id: "reise", title: "Reise", start: "2026-10-01", end: "2026-10-10" }} homeZoneReady />
      </LocaleProvider>,
    );
  });
}

async function click(el: Element | null | undefined) {
  expect(el).toBeTruthy();
  await act(async () => {
    (el as HTMLElement).click();
  });
}

const button = (text: string) => [...container!.querySelectorAll("button")].find((b) => b.textContent?.trim() === text);

describe("RouteRecordSection — the walk to \"Always\"", () => {
  test("first use: the switch shows both iOS steps, and arms only once Always is granted", async () => {
    shell.permission = { status: "notDetermined", precise: true, canAskAlways: true };
    shell.afterRequest = { status: "always", precise: true, canAskAlways: false };
    await mount();

    await click(container!.querySelector('[role="switch"]'));
    expect(shell.armRoute).not.toHaveBeenCalled();
    expect(container!.textContent).toContain("“Allow While Using App”");
    expect(container!.textContent).toContain("“Change to Always Allow”");

    await click(button("Continue"));
    expect(shell.requestLocationPermission).toHaveBeenCalledOnce();
    expect(shell.armRoute).not.toHaveBeenCalled();
    expect(container!.textContent).toContain("Location access is set to “Always”.");

    await click(button("Record my route"));
    expect(shell.armRoute).toHaveBeenCalledOnce();
  });

  test("Keep Only While Using: nothing is armed, and the page gives the Settings path instead", async () => {
    shell.permission = { status: "notDetermined", precise: true, canAskAlways: true };
    shell.afterRequest = { status: "whenInUse", precise: true, canAskAlways: false };
    await mount();

    await click(container!.querySelector('[role="switch"]'));
    await click(button("Continue"));
    expect(shell.armRoute).not.toHaveBeenCalled();
    expect(container!.textContent).toContain("Choose Always, and turn on Precise Location.");

    await click(button("Open Settings"));
    expect(shell.openAppSettings).toHaveBeenCalledOnce();
    expect(shell.armRoute).not.toHaveBeenCalled();
  });

  test("Always already granted: the switch arms straight away and the section says so", async () => {
    shell.permission = { status: "always", precise: true, canAskAlways: false };
    await mount();
    expect(container!.textContent).toContain("Location access: Always");

    await click(container!.querySelector('[role="switch"]'));
    expect(shell.requestLocationPermission).not.toHaveBeenCalled();
    expect(shell.armRoute).toHaveBeenCalledOnce();
  });

  test("Always without Precise Location is named, with a way to Settings", async () => {
    shell.permission = { status: "always", precise: false, canAskAlways: false };
    await mount();
    expect(container!.textContent).toContain("Precise Location is off");
    await click(button("Open Settings"));
    expect(shell.openAppSettings).toHaveBeenCalledOnce();
  });
});
