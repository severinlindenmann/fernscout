// @vitest-environment jsdom
//
// B2001 — `StudioBarProvider`/`useStudioBar` (`components/studio/StudioBar.tsx`)
// is what `app/[user]/studio/layout.tsx` wraps every studio page in, so it
// is the one place that guarantees a bottom bar on a plain subpage that
// registers nothing, and that a page in `replace` mode never shows the
// default link back to the studio alongside its own actions. The four
// pages that already had a bar before this ticket (the hub, the photobook
// chooser, the inbox and the postcard flow) are exercised through their own
// component tests; this covers the hook contract those all rely on.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import StudioBarProvider, { useStudioBar } from "@/components/studio/StudioBar";
import StepPrimary from "@/components/studio/StepPrimary";
import StudioPage from "@/components/studio/StudioPage";
import LocaleProvider from "@/components/LocaleProvider";
import { dictionaryFor } from "@/lib/locales";

// StudioPage's header is covered by its own tests; here only the bar matters.
vi.mock("@/components/PageHeader", () => ({ default: () => <header /> }));

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
});

function render(node: React.ReactNode) {
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

/** A page that registers nothing — every plain studio subpage today. */
function PlainPage() {
  return <p>a plain page</p>;
}

/** A page in `replace` mode — the hub, or the inbox/postcard while a sheet,
 *  confirm or selection is open. */
function ReplacingPage() {
  useStudioBar(<button type="button">Its own action</button>, { replace: true });
  return <p>a replacing page</p>;
}

describe("useStudioBar's default", () => {
  test("a page that registers nothing gets the back-to-studio link", () => {
    const el = render(<PlainPage />);
    const link = el.querySelector('a[href="/alex/studio"]');
    expect(link).not.toBeNull();
    expect(link!.textContent).toContain("Back to the studio");
  });
});

describe("useStudioBar replace mode", () => {
  test("a page in replace mode shows only its own actions, no back link", () => {
    const el = render(<ReplacingPage />);
    expect(el.querySelector('a[href="/alex/studio"]')).toBeNull();
    expect(el.textContent).toContain("Its own action");
  });
});

/**
 * B2002 — `useStudioBar` re-registers on every render *by design* (its own
 * `eslint-disable` comment says why: an inbox move sheet or a postcard
 * selection needs a fresh `actions` tree every time). `StepPrimary` calls
 * it once per mounted step, with a `disabled`/`busy` pair that flips while
 * a real flow is working (a fetch in flight, a field becoming valid) — the
 * risk this ticket named is that re-registering on every one of those
 * flips runs away into React's "Maximum update depth exceeded" loop rather
 * than converging to one provider update per caller re-render.
 *
 * It does not, and the reasoning is in `StudioBarProvider`'s own doc
 * comment: `setBar`/`clearBar` are the only things `value` exposes, `value`
 * itself is memoized on `clearBar` alone, and `clearBar` never changes — so
 * a `setBar` call re-renders `StudioBarProvider` and its own `ActionBar`,
 * never the caller that triggered it. There is nothing here to loop
 * through. This proves it by counting: ten re-renders make (at most) ten
 * provider updates, and React never raises its own overflow warning.
 */
function Host({ n }: { n: number }) {
  // A step primary whose disabled/busy state flips with every render — the
  // exact shape a real flow's own state changes produce.
  return <StepPrimary label={`Go ${n}`} disabled={n % 2 === 0} busy={n % 3 === 0} onClick={() => {}} />;
}

describe("StepPrimary/useStudioBar — re-registering on every render converges", () => {
  test("ten re-renders, no runaway update-depth warning, and the bar settles on the latest render", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    for (let n = 0; n < 10; n++) {
      act(() => {
        root!.render(
          <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
            <StudioBarProvider username="alex">
              <Host n={n} />
            </StudioBarProvider>
          </LocaleProvider>,
        );
      });
    }

    const overflow = errorSpy.mock.calls.some((args) =>
      args.some((a) => typeof a === "string" && a.includes("Maximum update depth exceeded")),
    );
    expect(overflow).toBe(false);

    // Settled on the last render's own label and disabled state — a stale
    // registration (or a loop that never settled) would show something
    // else here. n=9: `disabled` is false (9 is odd) but `busy` (9 % 3 ===
    // 0) still disables the button through `BusyButton`'s own rule —
    // settling on the *last* render's props, not a stale earlier one, is
    // the point.
    const barButtons = Array.from(container!.querySelectorAll("button")).filter((b) =>
      b.textContent?.includes("Go 9"),
    );
    expect(barButtons.length).toBeGreaterThan(0);
    expect(barButtons.every((b) => b.disabled)).toBe(true);

    errorSpy.mockRestore();
  });
});

/**
 * B2076 — the bar is one element at every width: sticky at the foot of a
 * phone, a static right-aligned row under the page from `md`. So the back
 * link and a step's primary are each in the document exactly once, and the
 * bar is not `md:hidden` on a StudioPage. jsdom applies no CSS; the classes
 * are the breakpoint.
 */
/** Links outside the bar's group sheet (B2141) matching `selector`. */
function backLinks(el: HTMLElement, selector: string) {
  return [...el.querySelectorAll(`a${selector}`)].filter((a) => !a.closest("[data-group-sheet]"));
}

describe("StepPrimary and the desktop row", () => {
  test("a step primary is in the document once, in the bar, and the bar shows at md on a StudioPage", () => {
    const el = render(
      <StudioPage username="alex" group="plan" title="A new trip">
        <StepPrimary label="Onwards" onClick={() => {}} />
      </StudioPage>,
    );
    const all = [...el.querySelectorAll("button")].filter((b) => b.textContent?.trim() === "Onwards");
    expect(all).toHaveLength(1);
    // The back link, once — the group sheet's six links (B2141) are not it.
    expect(backLinks(el, '[href^="/alex/studio#"]')).toHaveLength(1);
    const bar = all[0].parentElement!;
    expect(bar.className).not.toMatch(/(^|\s)md:hidden(\s|$)/);
    expect(bar.className.split(/\s+/)).toEqual(expect.arrayContaining(["md:static", "md:justify-end", "md:max-w-xl"]));
  });

  test("the hub (no StudioPage) keeps its bar phone-only", () => {
    const el = render(<PlainPage />);
    const bar = el.querySelector('a[href="/alex/studio"]')!.parentElement!;
    expect(bar.className.split(/\s+/)).toContain("md:hidden");
  });

  test("a page's own non-desktop actions stay phone-only; the back link still shows at md", () => {
    function Extending() {
      useStudioBar(<button type="button">Show more</button>);
      return <StudioPage username="alex" group="print" title="A photobook" />;
    }
    const el = render(<Extending />);
    const more = [...el.querySelectorAll("button")].find((b) => b.textContent === "Show more")!;
    expect(more.parentElement!.className.split(/\s+/)).toContain("md:hidden");
    expect(backLinks(el, '[href="/alex/studio#print"]')).toHaveLength(1);
  });
});

/** B2069 — the back link returns to the group the page belongs to. */
describe("the bar's back link carries the page's group", () => {
  test("with group plan the back href ends in #plan", () => {
    const el = render(<StudioPage username="alex" group="plan" title="Who sees the plan" />);
    const back = el.querySelector('a[aria-label="Back to the studio"]') as HTMLAnchorElement;
    expect(back.getAttribute("href")).toBe("/alex/studio#plan");
  });

  test("without a group it is /alex/studio", () => {
    const el = render(<PlainPage />);
    const back = el.querySelector('a[aria-label="Back to the studio"]') as HTMLAnchorElement;
    expect(back.getAttribute("href")).toBe("/alex/studio");
  });
});
