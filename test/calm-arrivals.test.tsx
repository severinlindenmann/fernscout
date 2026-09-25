// @vitest-environment jsdom
import fs from "node:fs";
import path from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { PhotoFrame } from "@/components/PhotoFrame";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Calm arrivals — the photograph shimmer and fade, the menus that grow out of
 * their buttons, and the bar along the top while a page is on its way.
 *
 * What a unit test can hold: a photograph is hidden only while it is known to
 * be missing (never one that had already loaded, which would stay hidden for
 * good), the progress bar starts only for a real in-site navigation and
 * finishes when the page arrives, and every new movement rests in place under
 * reduced motion. What the movements look like was checked in a browser.
 */

const ROOT = path.join(import.meta.dirname, "..");
const CSS = fs.readFileSync(path.join(ROOT, "app", "globals.css"), "utf8");

let root: Root | undefined;
let container: HTMLDivElement | undefined;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
});

/** jsdom never loads an image, so `complete` is set by hand before React
 * attaches — the state a real browser would be in at hydration. */
function renderPhoto(complete: boolean) {
  const spy = vi.spyOn(HTMLImageElement.prototype, "complete", "get").mockReturnValue(complete);
  act(() =>
    root!.render(
      <PhotoFrame className="tile">
        {(img) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img {...img} src="/p.jpg" alt="" />
        )}
      </PhotoFrame>,
    ),
  );
  spy.mockRestore();
  return container!.querySelector<HTMLElement>(".fs-photo")!;
}

describe("PhotoFrame", () => {
  test("a photograph still on its way is marked loading, and revealed once it arrives", () => {
    const frame = renderPhoto(false);
    expect(frame.hasAttribute("data-loading")).toBe(true);
    act(() => {
      frame.querySelector("img")!.dispatchEvent(new Event("load"));
    });
    expect(frame.hasAttribute("data-loading")).toBe(false);
  });

  test("a photograph that had already loaded is never hidden", () => {
    const frame = renderPhoto(true);
    expect(frame.hasAttribute("data-loading")).toBe(false);
  });

  test("a photograph that fails still stops the shimmer", () => {
    const frame = renderPhoto(false);
    act(() => {
      frame.querySelector("img")!.dispatchEvent(new Event("error"));
    });
    expect(frame.hasAttribute("data-loading")).toBe(false);
  });
});

const nav = vi.hoisted(() => ({ pathname: "/anna" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname }));

describe("NavProgress", () => {

  async function mount() {
    const { default: NavProgress } = await import("@/components/NavProgress");
    const render = () => act(() => root!.render(<NavProgress />));
    render();
    const bar = container!.querySelector<HTMLElement>(".fs-nav-progress")!;
    return { bar, render };
  }

  function click(href: string, init: MouseEventInit = {}, attrs: Record<string, string> = {}) {
    const a = document.createElement("a");
    a.href = href;
    for (const [k, v] of Object.entries(attrs)) a.setAttribute(k, v);
    // A real <Link> cancels the browser's own navigation, and jsdom cannot
    // navigate anyway; the bar listens in the capture phase, before that.
    a.addEventListener("click", (e) => e.preventDefault());
    document.body.append(a);
    act(() => {
      a.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ...init }));
    });
    a.remove();
  }

  beforeEach(() => {
    nav.pathname = "/anna";
    history.replaceState(null, "", "/anna");
  });

  test("an in-site link starts it, and the page arriving finishes it", async () => {
    const { bar, render } = await mount();
    expect(bar.dataset.state).toBe("idle");
    click("/anna/gallery");
    expect(bar.dataset.state).toBe("loading");
    nav.pathname = "/anna/gallery";
    render();
    expect(bar.dataset.state).toBe("done");
  });

  test("a new tab, another site, a download or this same page never starts it", async () => {
    const { bar } = await mount();
    click("/anna/gallery", { metaKey: true });
    click("/anna/gallery", {}, { target: "_blank" });
    click("https://example.org/elsewhere");
    click("/anna/export.zip", {}, { download: "" });
    click("/anna#day-3");
    expect(bar.dataset.state).toBe("idle");
  });

  test("it gives up rather than crawl forever", async () => {
    vi.useFakeTimers();
    try {
      const { bar } = await mount();
      click("/anna/map");
      expect(bar.dataset.state).toBe("loading");
      act(() => vi.advanceTimersByTime(10_000));
      expect(bar.dataset.state).toBe("idle");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("the CSS", () => {
  test("every keyframe named in an arbitrary `animate-[…]` class exists", () => {
    // `VisibilityPopover` named `fadeIn` for months with no such keyframe, so
    // its scrim never faded — Tailwind emits the rule either way.
    const walk = (dir: string): string[] =>
      fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(path.join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [path.join(dir, e.name)] : [],
      );
    const named = ["app", "components"].flatMap(walk).flatMap((f) =>
      [...fs.readFileSync(path.join(ROOT, f), "utf8").matchAll(/animate-\[([a-zA-Z][\w-]*)_/g)].map((m) => m[1]),
    );
    const missing = named.filter((name) => !new RegExp(`@keyframes ${name}\\b`).test(CSS));
    expect(missing).toEqual([]);
  });

  test("the movements run only for somebody who has not asked for less", () => {
    // Everything that moves is declared inside a no-preference block, so under
    // reduced motion each piece sits at its resting state: in place, visible.
    const block = /@media \(prefers-reduced-motion: no-preference\) \{([\s\S]*?)\n\}/g;
    const guarded = [...CSS.matchAll(block)].map((m) => m[1]).join("\n");
    const outside = CSS.replace(block, "");
    for (const name of ["fs-shimmer", "fs-pop-in", "fs-sheet-up", "fs-row-in", "fs-icon-turn", "fs-spin"]) {
      const uses = [...CSS.matchAll(new RegExp(`animation:[^;]*\\b${name}\\b`, "g"))];
      expect(uses.length, name).toBeGreaterThan(0);
      expect(guarded, name).toMatch(new RegExp(`\\b${name}\\b`));
      expect(outside, name).not.toMatch(new RegExp(`animation:[^;]*\\b${name}\\b`));
    }
  });
});
