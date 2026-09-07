// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import BackLink from "@/components/BackLink";
import BackTracker from "@/components/BackTracker";
import { BACK_HISTORY_KEY } from "@/components/useBackHistory";

/**
 * B822 — a back arrow has to retrace this app's own history when there is
 * one, and fall back to a fixed parent when there is not (a deep arrival off
 * an email link has no in-app page before it, and `router.back()` for that
 * reader would leave the site). `BackTracker` marks the flag on the first
 * client-side navigation in the tab; `BackLink` reads it and renders either a
 * real `<Link>` to the fallback or a `<button>` calling `router.back()`.
 */

let pathname = "/example/trips/asia-2023/gallery";
const back = vi.fn();
vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useRouter: () => ({ back }),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: React.ComponentProps<"a">) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

let root: Root | undefined;
let container: HTMLDivElement | undefined;

beforeEach(() => {
  sessionStorage.clear();
  back.mockClear();
  pathname = "/example/trips/asia-2023/gallery";
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
});

function render(node: React.ReactElement) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(node);
  });
}

const link = () => container!.querySelector("a");
const button = () => container!.querySelector("button");

test("a deep arrival — no in-app navigation yet — falls back to the fixed parent", () => {
  // BackTracker mounts on the very first pathname this tab has seen, which
  // by itself must never mark the flag: there is nothing before this page.
  render(<BackTracker />);

  render(
    <BackLink fallbackHref="/example" fallbackLabel="Your journals" retraceLabel="Back" />,
  );

  expect(link()).not.toBeNull();
  expect(link()!.getAttribute("href")).toBe("/example");
  expect(link()!.textContent).toBe("Your journals");
  expect(button()).toBeNull();
});

test("after an in-app navigation, the control retraces instead", () => {
  render(<BackTracker />);
  // The reader moves from the gallery to a photograph — a real client-side
  // navigation, which is what BackTracker is listening for.
  pathname = "/example/trips/asia-2023/gallery/photo-1";
  act(() => {
    root!.render(<BackTracker />);
  });
  expect(sessionStorage.getItem(BACK_HISTORY_KEY)).toBe("1");

  render(
    <BackLink fallbackHref="/example" fallbackLabel="Your journals" retraceLabel="Back" />,
  );

  expect(button()).not.toBeNull();
  expect(button()!.textContent).toBe("Back");
  expect(link()).toBeNull();

  act(() => {
    button()!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  expect(back).toHaveBeenCalledTimes(1);
});

describe("BackTracker", () => {
  test("never marks the flag on the first pathname it mounts with", () => {
    render(<BackTracker />);
    expect(sessionStorage.getItem(BACK_HISTORY_KEY)).toBeNull();
  });

  test("marks the flag once the pathname it sees changes", () => {
    render(<BackTracker />);
    pathname = "/example/trips/asia-2023/day/2024-05-01";
    act(() => {
      root!.render(<BackTracker />);
    });
    expect(sessionStorage.getItem(BACK_HISTORY_KEY)).toBe("1");
  });
});
