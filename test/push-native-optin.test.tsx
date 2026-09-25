// @vitest-environment jsdom
import { afterEach, describe, expect, test } from "vitest";
import { needsHomeScreenInstall } from "@/components/PushOptIn";

/**
 * B2115 — inside the iPhone shell there is nothing to add to a Home Screen:
 * the shell already is the app. `needsHomeScreenInstall` gates both
 * `PushInstallOnboarding`'s one-time sheet and `PushOptIn`'s own permanent
 * hint, so a regression here means either showing that sheet inside the
 * native app or, worse, offering the `PushManager` dance the shell has no
 * `PushManager` to answer.
 */

const CAPACITOR_KEY = "Capacitor";

afterEach(() => {
  delete (window as unknown as Record<string, unknown>)[CAPACITOR_KEY];
  Object.defineProperty(navigator, "userAgent", {
    value: "",
    configurable: true,
  });
  Object.defineProperty(navigator, "platform", {
    value: "",
    configurable: true,
  });
  Object.defineProperty(navigator, "maxTouchPoints", {
    value: 0,
    configurable: true,
  });
});

// jsdom has no matchMedia; an ordinary Safari tab is not display-mode: standalone.
window.matchMedia = ((query: string) => ({ matches: false, media: query })) as unknown as typeof window.matchMedia;

function setIphoneSafariUa() {
  Object.defineProperty(navigator, "userAgent", {
    value:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
    configurable: true,
  });
}

describe("needsHomeScreenInstall", () => {
  test("an iPhone in ordinary Safari, not added to the Home Screen: true", () => {
    setIphoneSafariUa();
    expect(needsHomeScreenInstall()).toBe(true);
  });

  test("the same iPhone, inside the Capacitor shell: false", () => {
    setIphoneSafariUa();
    (window as unknown as Record<string, unknown>)[CAPACITOR_KEY] = {
      isNativePlatform: () => true,
    };
    expect(needsHomeScreenInstall()).toBe(false);
  });

  test("a Capacitor bridge present but reporting web (not the shell): the ordinary iOS answer still applies", () => {
    setIphoneSafariUa();
    (window as unknown as Record<string, unknown>)[CAPACITOR_KEY] = {
      isNativePlatform: () => false,
    };
    expect(needsHomeScreenInstall()).toBe(true);
  });
});
