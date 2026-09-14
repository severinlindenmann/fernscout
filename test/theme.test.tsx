// @vitest-environment jsdom
import fs from "node:fs";
import path from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import LocaleProvider from "@/components/LocaleProvider";
import ThemePicker from "@/components/ThemePicker";
import ThemeSwitcher from "@/components/ThemeSwitcher";
import { dictionaryFor } from "@/lib/locales";
import { THEME_BOOTSTRAP, THEME_STORAGE_KEY, themeChoice } from "@/lib/theme";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let dark = false;
const listeners = new Set<() => void>();
let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  dark = false;
  listeners.clear();
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  document.querySelectorAll("meta[data-test-theme-color]").forEach((meta) => meta.remove());
  vi.stubGlobal("matchMedia", () => ({
    get matches() {
      return dark;
    },
    media: "(prefers-color-scheme: dark)",
    onchange: null,
    addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => true,
  }));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function render(Component = ThemePicker) {
  act(() => {
    root.render(
      <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
        <Component />
      </LocaleProvider>,
    );
  });
}

function option(label: string): HTMLInputElement {
  const found = [...host.querySelectorAll<HTMLInputElement>('input[type="radio"]')].find(
    (input) => input.parentElement?.textContent?.includes(label),
  );
  if (!found) throw new Error(`No ${label} appearance option`);
  return found;
}

function choose(label: string) {
  act(() => option(label).click());
}

describe("theme preference", () => {
  test("only explicit, valid values survive parsing", () => {
    expect(themeChoice("light")).toBe("light");
    expect(themeChoice("dark")).toBe("dark");
    expect(themeChoice("auto")).toBe("auto");
    expect(themeChoice("sepia")).toBe("auto");
    expect(themeChoice(null)).toBe("auto");
  });

  test("the head bootstrap applies an explicit choice and ignores malformed storage", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    window.eval(THEME_BOOTSTRAP);
    expect(document.documentElement.dataset.theme).toBe("dark");

    localStorage.setItem(THEME_STORAGE_KEY, "sepia");
    window.eval(THEME_BOOTSTRAP);
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });

  test("light and dark apply immediately and survive in browser storage", () => {
    render();
    choose("Dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(option("Dark").checked).toBe(true);

    choose("Light");
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
  });

  test("automatic removes the override and reports a live system change", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    render();
    choose("Automatic");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
    expect(host.textContent).toContain("Currently Light");

    act(() => {
      dark = true;
      listeners.forEach((listener) => listener());
    });
    expect(host.textContent).toContain("Currently Dark");
  });

  test("unavailable storage falls back to automatic", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementationOnce(() => {
      throw new DOMException("refused");
    });
    render();
    expect(option("Automatic").checked).toBe(true);
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });

  test("the compact switcher offers the same browser-local choices in page chrome", () => {
    render(ThemeSwitcher);
    const trigger = host.querySelector<HTMLButtonElement>('button[aria-label="Appearance"]');
    if (!trigger) throw new Error("No compact appearance switcher");
    act(() => trigger.click());

    const darkChoice = [...host.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')].find(
      (button) => button.textContent?.includes("Dark"),
    );
    if (!darkChoice) throw new Error("No Dark compact appearance choice");
    act(() => darkChoice.click());

    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
  });

  test("an explicit choice also overrides the browser chrome colour", () => {
    for (const [colour, media] of [
      ["#ffd23f", "(prefers-color-scheme: light)"],
      ["#171d29", "(prefers-color-scheme: dark)"],
    ]) {
      const meta = document.createElement("meta");
      meta.name = "theme-color";
      meta.content = colour;
      meta.media = media;
      meta.dataset.testThemeColor = "1";
      document.head.append(meta);
    }
    render();
    choose("Dark");
    const [light, darkMeta] = document.querySelectorAll<HTMLMetaElement>(
      "meta[data-test-theme-color]",
    );
    expect(light.media).toBe("not all");
    expect(darkMeta.media).toBe("all");

    choose("Automatic");
    expect(light.media).toBe("(prefers-color-scheme: light)");
    expect(darkMeta.media).toBe("(prefers-color-scheme: dark)");
  });

  test("the root layout runs the bootstrap before the body and advertises both schemes", () => {
    const layout = fs.readFileSync(path.join(process.cwd(), "app/layout.tsx"), "utf8");
    expect(layout.indexOf("<ThemeScript")).toBeLessThan(layout.indexOf("<body"));
    expect(layout).toContain("suppressHydrationWarning");
    expect(layout).toContain('colorScheme: "light dark"');

    const script = fs.readFileSync(
      path.join(process.cwd(), "components/ThemeScript.tsx"),
      "utf8",
    );
    expect(script).toContain('typeof window === "undefined" ? "text/javascript" : "text/plain"');
    expect(script).toContain("suppressHydrationWarning");
  });
});
