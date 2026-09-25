// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import InboxTile from "@/components/studio/inbox/InboxTile";
import LocaleProvider from "@/components/LocaleProvider";
import { dictionaryFor } from "@/lib/locales";
import type { InboxRow } from "@/lib/studio/inbox";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * B2082 — the location flow leaves the raw export in the inbox. Its tile
 * says it is kept privately and never published, and offers no way onto a
 * day; any other file keeps its move button and carries no such note.
 */
let root: Root | undefined;
let container: HTMLDivElement;
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
});

function render(row: InboxRow) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    root!.render(
      <LocaleProvider dictionary={dictionaryFor("en")} locale="en">
        <ul>
          <InboxTile
            username="alex"
            row={row}
            selected={false}
            onToggle={() => {}}
            onMoveOne={() => {}}
            onDeleteOne={() => {}}
            thumbSrc={() => ""}
            hasThumbFailed={false}
            onThumbError={() => {}}
          />
        </ul>
      </LocaleProvider>,
    ),
  );
}

const moveButton = () => [...container.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Move");

const base = { id: "x", kind: "files" as const, day: null, bytes: 2048, uploadedAt: "2026-05-04T10:00:00Z" };

describe("the inbox tile of a location export — B2082", () => {
  test("a timeline.json tile says it is kept privately and has no move button", () => {
    render({ ...base, name: "timeline.json", type: "location", preview: { kind: "location", format: "Google Maps Timeline (phone export)" } });
    const kept = "Kept privately — the places in it are never shown here and never published.";
    expect(container.textContent).toContain(kept);
    expect(moveButton()).toBeUndefined();
    // Opening the preview does not say it a second time.
    act(() => [...container.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Preview")!.click());
    expect(container.textContent!.split(kept)).toHaveLength(2);
  });

  test("a statement tile keeps its move button and carries no such note", () => {
    render({ ...base, name: "statement.csv", type: "statement" });
    expect(container.textContent).not.toContain("Kept privately");
    expect(moveButton()).toBeDefined();
  });
});

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }), usePathname: () => "/alex/studio/inbox" }));

describe("the inbox's selection bar cannot move a location export — B2082", () => {
  test("a selected timeline.json alone offers no move", async () => {
    const { default: InboxHub } = await import("@/components/studio/inbox/InboxHub");
    const { default: StudioBarProvider } = await import("@/components/studio/StudioBar");
    const model = {
      waiting: [{ ...base, name: "timeline.json", type: "location" as const, preview: { kind: "location" as const, format: null } }],
      days: [],
      dayBounds: { start: "2026-05-01", end: "2026-05-10" },
      writtenDates: [],
      entriesByDate: {},
    };
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() =>
      root!.render(
        <LocaleProvider dictionary={dictionaryFor("en")} locale="en">
          <StudioBarProvider username="alex">
            <InboxHub username="alex" model={model} />
          </StudioBarProvider>
        </LocaleProvider>,
      ),
    );
    act(() => container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    expect([...container.querySelectorAll("button")].some((b) => /move/i.test(b.textContent ?? ""))).toBe(false);
  });
});

describe("a location-typed tile draws the map pin — B2110", () => {
  const glyph = () =>
    Array.from(container.querySelector("svg")?.classList ?? []).find((c) => c.startsWith("lucide-") && c !== "lucide-icon");
  test("Timeline.json typed location shows the map pin, not the document", () => {
    render({ ...base, name: "Timeline.json", type: "location", preview: { kind: "location", format: "Google Maps Timeline (phone export)" } });
    expect(glyph()).toBe("lucide-map-pin");
  });
  test("a plain document keeps the document glyph", () => {
    render({ ...base, name: "notes.pdf", type: "document" });
    expect(glyph()).toBe("lucide-file-text");
  });
});
