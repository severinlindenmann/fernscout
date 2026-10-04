// @vitest-environment jsdom
//
// B2854 - a flow's header says Cancel (asking first when something was
// entered) and its bottom bar says Previous, one history step back.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import StudioBarProvider, { useStudioFlow } from "@/components/studio/StudioBar";
import StepPrimary from "@/components/studio/StepPrimary";
import StudioPage from "@/components/studio/StudioPage";
import LocaleProvider from "@/components/LocaleProvider";
import { dictionaryFor } from "@/lib/locales";

// The header's own look is covered elsewhere; here it only exposes its cancel.
vi.mock("@/components/PageHeader", () => ({
  default: ({ cancel }: { cancel?: { label: string; onClick: () => void } }) => (
    <header>{cancel && <button onClick={cancel.onClick}>{cancel.label}</button>}</header>
  ),
}));

const push = vi.fn();
vi.mock("next/navigation", () => ({
  usePathname: () => "/@alex/studio/people",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push }),
}));

let root: Root | undefined;
let container: HTMLDivElement | undefined;
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  push.mockReset();
});

function Flow({ dirty, onPrevious, active = true }: { dirty: boolean; onPrevious?: () => void; active?: boolean }) {
  useStudioFlow(active ? { dirty, keeps: "tab", leaveKey: "studio.flow.leavePeople", onPrevious } : null);
  return <StepPrimary label="Next thing" onClick={() => {}} />;
}

function render(flow: React.ReactNode) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
        <StudioBarProvider username="alex">
          <StudioPage username="alex" title="People">
            {flow}
          </StudioPage>
        </StudioBarProvider>
      </LocaleProvider>,
    );
  });
  return container;
}

const button = (el: HTMLElement, text: string) =>
  [...el.querySelectorAll("button")].find((b) => b.textContent?.includes(text));
const click = (b: Element | undefined) => act(() => b!.dispatchEvent(new MouseEvent("click", { bubbles: true })));

describe("registration", () => {
  test("a fresh onPrevious closure on every render (useStep's back) does not loop", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    function Fresh() {
      const back = () => {}; // new identity each render, like useStep's back
      useStudioFlow({ dirty: false, keeps: "tab", leaveKey: "studio.flow.leavePeople", onPrevious: back });
      return <StepPrimary label="Next thing" onClick={() => {}} />;
    }
    const el = render(<Fresh />);
    expect(errorSpy.mock.calls.some((a) => String(a[0]).includes("Maximum update depth"))).toBe(false);
    expect(button(el, "Previous")).toBeTruthy();
    errorSpy.mockRestore();
  });
});

describe("bar Previous", () => {
  test("replaces the back link beside the step primary and steps back once", () => {
    const onPrevious = vi.fn();
    const el = render(<Flow dirty={false} onPrevious={onPrevious} />);
    expect(el.querySelector('a[href="/@alex/studio"]')).toBeNull();
    click(button(el, "Previous"));
    expect(onPrevious).toHaveBeenCalledTimes(1);
    expect(button(el, "Next thing")).toBeTruthy();
  });

  test("a flow with no previous step keeps the plain back link", () => {
    const el = render(<Flow dirty={false} active={false} />);
    expect(el.querySelector('a[href="/@alex/studio"]')).not.toBeNull();
    expect(button(el, "Previous")).toBeUndefined();
    expect(button(el, "Cancel")).toBeUndefined();
  });
});

describe("header Cancel", () => {
  test("untouched: leaves at once to the parent, no question", () => {
    const el = render(<Flow dirty={false} onPrevious={() => {}} />);
    click(button(el, "Cancel"));
    expect(push).toHaveBeenCalledWith("/@alex/studio");
    expect(el.querySelector('[role="dialog"]')).toBeNull();
  });

  test("with input: asks first, says what is kept, leaves only on the action button", () => {
    const el = render(<Flow dirty onPrevious={() => {}} />);
    click(button(el, "Cancel"));
    const dialog = el.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain("stays in this tab");
    expect(push).not.toHaveBeenCalled();
    click(button(el, "Stay here"));
    expect(el.querySelector('[role="dialog"]')).toBeNull();
    click(button(el, "Cancel"));
    click(button(el, "Leave this list of people"));
    expect(push).toHaveBeenCalledWith("/@alex/studio");
  });
});
