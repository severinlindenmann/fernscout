// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import { currentSearch, navigationMock, resetNavigation } from "./fixtures/fakeNavigation";
import FigureLibrary from "@/components/studio/figures/FigureLibrary";
import StudioBarProvider from "@/components/studio/StudioBar";
import LocaleProvider from "@/components/LocaleProvider";
import { dictionaryFor } from "@/lib/locales";
import type { FigureDoc } from "@/lib/api/v2/schemas/figures";
import type { FigureTripRow } from "@/lib/figures";

// B2136 — reshape and the figure creator keep their step in the URL (`useStep`).
vi.mock("next/navigation", async () => (await import("./fixtures/fakeNavigation")).navigationMock("/alex/studio/figures"));

/**
 * B2089 — the figure library says what happened. A party row carries its
 * state in `aria-pressed` and in words ("walks" / "does not walk"), not in
 * fill alone; and after the creator saves, the library shows a
 * "Saved — <name>." status line with the new figure in the grid.
 */

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(() => {
  resetNavigation();
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
  vi.unstubAllGlobals();
});

const anna: FigureDoc = { id: "anna", name: "Anna" } as FigureDoc;
const trip: FigureTripRow = {
  id: "alps-2024",
  title: "Alps",
  start: "2024-07-01",
  end: "2024-07-10",
  status: "past",
  answer: "custom",
  figures: [],
  people: [],
};

function render(figures: FigureDoc[], journalSet: string[] = [], trips: FigureTripRow[] = [trip]) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
        <StudioBarProvider username="alex">
          <FigureLibrary
            username="alex"
            initialFigures={figures}
            contacts={[]}
            initialJournalSet={journalSet}
            trips={trips}
            photoConsent={false}
            photoCredits={0}
          />
        </StudioBarProvider>
      </LocaleProvider>,
    );
  });
}

function button(text: string): HTMLButtonElement {
  const found = [...container!.querySelectorAll("button")].find((b) => b.textContent?.includes(text));
  if (!found) throw new Error(`no button "${text}"`);
  return found as HTMLButtonElement;
}

describe("figure library feedback", () => {
  test("a party row toggles aria-pressed and says whether the figure walks", () => {
    render([anna]);
    act(() => button("Alps").click());
    const row = button("Anna");
    expect(row.getAttribute("aria-pressed")).toBe("false");
    expect(row.textContent).toContain("does not walk");
    act(() => row.click());
    expect(row.getAttribute("aria-pressed")).toBe("true");
    expect(row.textContent).not.toContain("does not walk");
    expect(row.textContent).toContain("walks");
  });

  test("after saving a new figure the library shows a status line and the figure", async () => {
    const seven = Array.from({ length: 7 }, (_, i) => ({ id: `f${i}`, name: `F${i}` }) as FigureDoc);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ id: "qa", name: "QA" }), { status: 200 })),
    );
    render(seven);
    act(() => button("New figure").click());
    const input = container!.querySelector<HTMLInputElement>("#figure-new-name")!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "QA");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => button("Continue").click());
    act(() => button("Plain").click());
    act(() => button("Next").click());
    // B2136 — the creator's screen is ?figure=; Back is the screen before.
    expect(currentSearch()).toBe("figure=shape");
    act(() => navigationMock("").useRouter().back());
    expect(container!.querySelector("h2")?.textContent).toContain("Start from");
    act(() => button("Next").click());
    await act(async () => button("Save").click());
    expect(currentSearch()).toBe("");

    const status = container!.querySelector('[role="status"]');
    expect(status?.textContent).toBe("Saved — QA.");
    // Seven older figures, the preview shows six: the new one leads anyway.
    expect(container!.querySelector("#figure-qa")).not.toBeNull();
  });
});

describe("B2139 — the library names things", () => {
  test("each Remove in the set says which figure it removes", () => {
    render([anna, { id: "ben", name: "Ben" } as FigureDoc], ["anna", "ben"]);
    const removes = [...container!.querySelectorAll("button")].map((b) => b.textContent ?? "").filter((x) => x.startsWith("Remove"));
    expect(removes).toEqual(["Remove Anna", "Remove Ben"]);
  });

  test("a figure's subtitle never shows an email address", () => {
    render([{ id: "cleo", name: "Cleo", person: "cleo@example.com" } as FigureDoc]);
    expect(container!.textContent).not.toContain("cleo@example.com");
  });

  test("a trip that said no with a reason reads as said no, not unanswered", () => {
    render([anna], [], [{ ...trip, answer: "declined", declinedReason: "just landscapes" } as FigureTripRow]);
    expect(button("Alps").textContent).toContain("Said no");
    expect(button("Alps").textContent).not.toContain("Not answered yet");
  });
});
