// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import NewTripFlow from "@/components/studio/trip/NewTripFlow";
import StudioBarProvider from "@/components/studio/StudioBar";
import LocaleProvider from "@/components/LocaleProvider";
import { dictionaryFor } from "@/lib/locales";

// B2077 — NewTripFlow keeps its step in the URL (`useStep`), which needs the
// app router; a first render only reads `?step=`, so an empty one will do.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/alex/studio/trip/new",
  useSearchParams: () => new URLSearchParams(),
}));

/**
 * B1901 — setting the last day before the first day on "A new trip" greyed
 * out "Next: the optional things" (since B2187 the one "Create trip") and
 * said nothing at all. This proves the
 * screen now states the problem, next to the field that is wrong, and that
 * the message goes away the moment the dates are sane again — a disabled
 * button with a permanently-shown error would be its own new defect.
 */

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(() => {
  // The flow saves a session draft (B2077); one test's typing must not
  // reappear in the next.
  sessionStorage.clear();
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
});

function setInputValue(el: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function findButtonByText(root: HTMLElement, text: string): HTMLButtonElement {
  const btn = Array.from(root.querySelectorAll("button")).find((b) => b.textContent?.trim() === text);
  if (!btn) throw new Error(`no button with text ${JSON.stringify(text)}`);
  return btn as HTMLButtonElement;
}

describe("NewTripFlow — an impossible date range says why", () => {
  test("last day before first day: the button is disabled AND the reason names the dates", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root!.render(
        <LocaleProvider dictionary={dictionaryFor("en")} locale="en">
          <StudioBarProvider username="alex">
            <NewTripFlow
              username="alex"
              visibilities={["guest", "public", "private"]}
              accents={["sky"]}
              existingTrips={[]}
              whatsappAvailable={false}
              otherLocales={[]}
              defaultLocale="en"
              baseCurrency="CHF"
              currencies={["CHF"]}
              contacts={[]}
              figures={[]}
              journalFigures={[]}
            />
          </StudioBarProvider>
        </LocaleProvider>,
      );
    });

    const titleInput = container!.querySelector("input[type=text]") as HTMLInputElement;
    const [startInput, endInput] = Array.from(container!.querySelectorAll("[data-date-field] input")) as HTMLInputElement[];

    act(() => {
      setInputValue(titleInput, "Round the Alps");
      setInputValue(startInput, "2026-05-10");
      setInputValue(endInput, "2026-05-01");
    });

    const cta = findButtonByText(container!, "Create trip");
    expect(cta.disabled).toBe(true);
    expect(container!.textContent).toContain("The last day is before the first day — move one of them.");

    // Fixing the range clears both the disabled state and the message —
    // this is a live explanation, not a banner that outlives the problem.
    act(() => {
      setInputValue(endInput, "2026-05-15");
    });
    expect(cta.disabled).toBe(false);
    expect(container!.textContent).not.toContain("The last day is before the first day");
  });

  test("still-empty dates disable the button with no error shown — that gap is self-evident from the empty fields", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root!.render(
        <LocaleProvider dictionary={dictionaryFor("en")} locale="en">
          <StudioBarProvider username="alex">
            <NewTripFlow
              username="alex"
              visibilities={["guest", "public", "private"]}
              accents={["sky"]}
              existingTrips={[]}
              whatsappAvailable={false}
              otherLocales={[]}
              defaultLocale="en"
              baseCurrency="CHF"
              currencies={["CHF"]}
              contacts={[]}
              figures={[]}
              journalFigures={[]}
            />
          </StudioBarProvider>
        </LocaleProvider>,
      );
    });

    const cta = findButtonByText(container!, "Create trip");
    expect(cta.disabled).toBe(true);
    expect(container!.textContent).not.toContain("The last day is before the first day");
  });
});
